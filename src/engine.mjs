/** GoreeCloud Automations: portable, dependency-free workflow engine foundation. */
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const intervalMinMs = 60_000;
const intervalMaxMs = 31 * 24 * 60 * 60 * 1000;
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const validUtc = value => typeof value === 'string' && utcTimestamp.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export class MemoryStore {
  #jobs = new Map();
  async get(id) { return this.#jobs.has(id) ? copy(this.#jobs.get(id)) : null; }
  async createIfAbsent(job) {
    if (this.#jobs.has(job.id)) return false;
    this.#jobs.set(job.id, copy(job));
    return true;
  }
  async put(job) { this.#jobs.set(job.id, copy(job)); }
  async list() { return [...this.#jobs.values()].map(copy); }
}

function validateWorkflow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Workflow must be an object');
  const w = copy(input);
  if (!safeId.test(w.id || '') || w.version !== 1 || typeof w.name !== 'string' || !w.name.trim()) {
    throw new TypeError('Invalid workflow id, name, or version');
  }
  if (w.enabled !== true && w.enabled !== false) throw new TypeError('enabled must be boolean');
  if (!Array.isArray(w.triggers) || w.triggers.length < 1 || w.triggers.length > 16 ||
      w.triggers.some(t => !t || (t.type === 'event'
        ? !safeId.test(t.name || '')
        : t.type === 'interval'
          ? !Number.isSafeInteger(t.everyMs) || t.everyMs < intervalMinMs ||
            t.everyMs > intervalMaxMs || !validUtc(t.anchorAt)
          : true))) {
    throw new TypeError('Invalid event or interval trigger');
  }
  if (!Array.isArray(w.steps) || !w.steps.length || w.steps.length > 128) {
    throw new TypeError('Workflow needs 1-128 steps');
  }
  const ids = new Set();
  for (const step of w.steps) {
    if (!step || !safeId.test(step.id || '') || ids.has(step.id) || !safeId.test(step.action || '')) {
      throw new TypeError('Invalid or duplicate step');
    }
    ids.add(step.id);
    if (step.when) {
      const cond = step.when;
      if (!['eq', 'ne', 'exists'].includes(cond.op) || typeof cond.path !== 'string' ||
          !cond.path.startsWith('payload.') || cond.path.split('.').some(part => forbidden.has(part))) {
        throw new TypeError('Unsupported condition');
      }
    }
  }
  return w;
}

function matches(when, payload) {
  if (!when) return true;
  const path = when.path.slice('payload.'.length).split('.');
  let current = payload;
  for (const part of path) {
    if (forbidden.has(part) || current === null || typeof current !== 'object' ||
        !Object.prototype.hasOwnProperty.call(current, part)) {
      current = undefined;
      break;
    }
    current = current[part];
  }
  if (when.op === 'exists') return current !== undefined && current !== null;
  return when.op === 'eq' ? current === when.value : current !== when.value;
}

/**
 * Host-provided capabilities are the only side-effecting actions. The host MUST
 * supply real Identity/Privacy/Security/Policy enforcement; default is deny.
 * Network actions are deferred while offline. Job store must persist securely
 * and implement atomic createIfAbsent for production deployments.
 */
export class WorkflowEngine {
  #workflows = new Map();
  #actions = new Map();
  #flights = new Map();

  constructor({ store = new MemoryStore(), authorize = async () => false,
                online = () => false, now = () => new Date().toISOString(),
                onTransition = () => {} } = {}) {
    this.store = store;
    this.authorize = authorize;
    this.online = online;
    this.now = now;
    this.onTransition = onTransition;
  }

  registerWorkflow(workflow) {
    const value = validateWorkflow(workflow);
    this.#workflows.set(value.id, value);
    return value.id;
  }

  registerAction(name, { execute, requiresNetwork = false, capability, replaySafe = false } = {}) {
    if (!safeId.test(name || '') || typeof execute !== 'function' ||
        !safeId.test(capability || '') || typeof requiresNetwork !== 'boolean' || typeof replaySafe !== 'boolean') {
      throw new TypeError('Action needs a name, capability, and execute function');
    }
    this.#actions.set(name, { execute, requiresNetwork, capability, replaySafe });
  }

  async emit(eventName, eventId, payload = {}, actor = null) {
    if (!safeId.test(eventName || '')) throw new TypeError('Invalid event name');
    const matchesEvent = [...this.#workflows.values()].filter(w => w.enabled &&
      w.triggers.some(t => t.name === eventName));
    return Promise.all(matchesEvent.map(w => this.run(w.id, { eventId, payload, actor })));
  }

  async run(workflowId, { eventId, payload = {}, actor = null } = {}) {
    const workflow = this.#workflows.get(workflowId);
    if (!workflow || !workflow.enabled || !safeId.test(eventId || '')) {
      throw new TypeError('Enabled workflow and stable eventId are required');
    }
    const id = workflowId + ':' + eventId;
    return this.#singleFlight(id, async () => {
      const existing = await this.store.get(id);
      if (existing) return existing;
      const job = { id, workflowId, eventId, payload: copy(payload), actor: copy(actor),
        cursor: 0, status: 'running', stepHistory: [], workflowSnapshot: copy(workflow),
        createdAt: this.now(), updatedAt: this.now() };
      const created = await this.store.createIfAbsent(job);
      if (!created) return this.store.get(id);
      return this.#execute(job, workflow);
    });
  }

  async resume(jobId) {
    if (!safeId.test(jobId || '') && !/^[a-zA-Z0-9._:-]{1,128}:[a-zA-Z0-9._:-]{1,128}$/.test(jobId || '')) {
      throw new TypeError('Invalid job id');
    }
    return this.#singleFlight(jobId, async () => {
      const job = await this.store.get(jobId);
      if (!job) throw new Error('Unknown job');
      if (job.status !== 'waiting_network') return job;
      const workflow = this.#workflows.get(job.workflowId);
      if (!workflow || !workflow.enabled || !job.workflowSnapshot) return this.#set(job, 'blocked', 'WORKFLOW_UNAVAILABLE');
      return this.#execute(job, job.workflowSnapshot);
    });
  }

  /**
   * One deterministic interval occurrence per trigger at the supplied UTC tick.
   * The host supplies OS-allowed wakeups. Missed earlier slots are deliberately
   * skipped (latest-only) and no background scheduling is implied.
   */
  async tick(at = this.now()) {
    if (!validUtc(at)) throw new TypeError('tick needs a canonical UTC timestamp');
    const instant = Date.parse(at);
    const runs = [];
    for (const workflow of this.#workflows.values()) {
      if (!workflow.enabled) continue;
      for (const [index, trigger] of workflow.triggers.entries()) {
        if (trigger.type !== 'interval') continue;
        const anchor = Date.parse(trigger.anchorAt);
        if (instant < anchor) continue;
        const slot = Math.floor((instant - anchor) / trigger.everyMs);
        const due = anchor + slot * trigger.everyMs;
        const eventId = `interval-${index}-${due}`;
        runs.push(this.run(workflow.id, { eventId, payload: {
          scheduledAt: new Date(due).toISOString(), triggerType: 'interval',
        } }));
      }
    }
    return Promise.all(runs);
  }

  async pending() { return (await this.store.list()).filter(j => j.status === 'waiting_network'); }

  /** Process queued network steps only when a host explicitly invokes this. */
  async resumePending() {
    const jobs = await this.pending();
    return Promise.all(jobs.map(job => this.resume(job.id)));
  }

  /** Cancel only a queued network step; an already-running effect cannot be undone. */
  async cancel(jobId) {
    return this.#singleFlight(jobId, async () => {
      const job = await this.store.get(jobId);
      if (!job) throw new Error('Unknown job');
      if (job.status !== 'waiting_network') return job;
      delete job.inflightStepId;
      return this.#set(job, 'cancelled');
    });
  }

  /**
   * Inspect interruption survivors. Never blindly replay a side-effecting
   * action: the host may have completed it before the process crashed.
   */
  async interrupted() { return (await this.store.list()).filter(j => j.status === 'running'); }

  async recover(jobId) {
    return this.#singleFlight(jobId, async () => {
      const job = await this.store.get(jobId);
      if (!job) throw new Error('Unknown job');
      if (job.status !== 'running') return job;
      const workflow = this.#workflows.get(job.workflowId);
      if (!workflow || !workflow.enabled || !job.workflowSnapshot) return this.#set(job, 'blocked', 'WORKFLOW_UNAVAILABLE');
      if (job.inflightStepId) {
        const step = job.workflowSnapshot.steps[job.cursor];
        const action = step && this.#actions.get(step.action);
        if (!step || step.id !== job.inflightStepId || action?.replaySafe !== true) {
          return this.#set(job, 'blocked', 'ACTION_OUTCOME_UNKNOWN');
        }
      }
      return this.#execute(job, job.workflowSnapshot);
    });
  }

  async #singleFlight(id, fn) {
    if (this.#flights.has(id)) return this.#flights.get(id);
    const task = Promise.resolve().then(fn).finally(() => this.#flights.delete(id));
    this.#flights.set(id, task);
    return task;
  }

  async #set(job, status, errorCode = null) {
    job.status = status;
    job.updatedAt = this.now();
    if (errorCode) job.errorCode = errorCode;
    else delete job.errorCode;
    await this.store.put(job);
    // Never emit event payloads, actor details, action inputs, or secrets.
    this.onTransition({ id: job.id, workflowId: job.workflowId, cursor: job.cursor, status });
    return copy(job);
  }

  async #execute(job, workflow) {
    for (; job.cursor < workflow.steps.length;) {
      const step = workflow.steps[job.cursor];
      if (!matches(step.when, job.payload)) {
        job.stepHistory.push({ stepId: step.id, status: 'skipped' });
        job.cursor++;
        await this.#set(job, 'running');
        continue;
      }
      const action = this.#actions.get(step.action);
      if (!action) return this.#set(job, 'blocked', 'ACTION_UNAVAILABLE');
      let permitted = false;
      try {
        permitted = await this.authorize({ workflowId: workflow.id, stepId: step.id,
          capability: action.capability, actor: job.actor, input: step.input ?? null });
      } catch { permitted = false; }
      if (permitted !== true) return this.#set(job, 'blocked', 'AUTHORIZATION_DENIED');
      if (action.requiresNetwork && !this.online()) return this.#set(job, 'waiting_network');
      // Durable checkpoint before external effects. Once set, an interrupted
      // action is never replayed unless the host declares replaySafe.
      job.inflightStepId = step.id;
      await this.#set(job, 'running');
      try {
        await action.execute({ input: copy(step.input ?? null), payload: copy(job.payload),
          actor: copy(job.actor), idempotencyKey: job.id + ':' + step.id });
      } catch {
        // Do not leak potentially sensitive adapter errors into job state.
        return this.#set(job, 'failed', 'ACTION_FAILED');
      }
      job.stepHistory.push({ stepId: step.id, status: 'succeeded' });
      job.cursor++;
      delete job.inflightStepId;
      await this.#set(job, 'running');
    }
    return this.#set(job, 'succeeded');
  }
}
