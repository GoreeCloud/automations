/** Portable, side-effect-free workflow authoring state. No OS authority or action execution. */
import { previewWorkflow } from '../src/engine.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_BYTES = 256 * 1024;
const MAX_STEPS = 128;

/** In-memory undo history. Never persists workflow data or invokes actions. */
export function createHistory(initial, limit = 32) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new RangeError('Invalid undo limit');
  return { past: [], present: clone(initial), future: [], limit, group: null };
}

/** Coalesce consecutive edits of one text field into a single undo point. */
export function recordHistory(history, next, group = null) {
  const present = clone(next);
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  const grouped = typeof group === 'string' && group.length > 0 && group === history.group && history.past.length > 0;
  const past = grouped ? history.past.slice() : [...history.past, clone(history.present)].slice(-history.limit);
  return { past, present, future: [], limit: history.limit, group: grouped ? group : (group || null) };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: clone(history.past.at(-1)),
    future: [clone(history.present), ...history.future].slice(0, history.limit), limit: history.limit, group: null };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  return { past: [...history.past, clone(history.present)].slice(-history.limit),
    present: clone(history.future[0]), future: history.future.slice(1), limit: history.limit, group: null };
}

/** Validate and clone a bounded, non-executable starter catalog. */
export function loadStarters(raw, catalog) {
  if (!Array.isArray(raw) || raw.length > 16 || raw.length < 1) {
    throw new TypeError('Invalid starter catalog');
  }
  const ids = new Set();
  return raw.map(template => {
    if (!template || typeof template !== 'object' || Array.isArray(template) ||
        !safeId.test(template.id || '') || ids.has(template.id) ||
        typeof template.label !== 'string' || !template.label.trim() || template.label.length > 90 ||
        typeof template.description !== 'string' || template.description.length > 240 ||
        !template.workflow || template.workflow.enabled !== false) {
      throw new TypeError('Invalid starter template');
    }
    validateDraft(template.workflow, catalog);
    ids.add(template.id);
    return clone(template);
  });
}

export function selectStarter(starters, id, catalog) {
  const entry = starters.find(item => item.id === id);
  if (!entry) throw new RangeError('Unknown starter template');
  const draft = clone(entry.workflow);
  draft.enabled = false;
  validateDraft(draft, catalog);
  return draft;
}

export function createDraft() {
  return {
    id: 'new-workflow', version: 1, name: 'Untitled workflow', enabled: false,
    triggers: [{ type: 'event', name: 'event.received' }],
    steps: [{ id: 'step-1', action: 'local.note', input: { title: 'New note' } }],
  };
}

export function validateDraft(workflow, catalog) {
  return previewWorkflow(workflow, { actions: catalog, payload: {}, online: false });
}

export function importDraft(raw, catalog) {
  if (typeof raw !== 'string' || BufferSafeLength(raw) > MAX_BYTES) {
    throw new TypeError('Workflow file exceeds the supported size');
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError('Invalid workflow JSON'); }
  validateDraft(parsed, catalog);
  return clone(parsed);
}

function BufferSafeLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length * 3; // conservative fallback for supported valid UTF-16 strings
}

export function exportDraft(workflow, catalog) {
  validateDraft(workflow, catalog);
  return JSON.stringify(workflow, null, 2) + '\n';
}

export function appendStep(workflow, action = 'local.note') {
  if (!safeId.test(action)) throw new TypeError('Invalid action identifier');
  if (workflow.steps.length >= MAX_STEPS) throw new RangeError('Step limit reached');
  const draft = clone(workflow);
  let suffix = 1;
  const ids = new Set(draft.steps.map(step => step.id));
  while (ids.has(`step-${suffix}`)) suffix += 1;
  draft.steps.push({ id: `step-${suffix}`, action, input: {} });
  return draft;
}

export function removeStep(workflow, index) {
  if (!Number.isInteger(index) || index < 0 || index >= workflow.steps.length || workflow.steps.length < 2) {
    throw new RangeError('A workflow must retain at least one step');
  }
  const draft = clone(workflow);
  draft.steps.splice(index, 1);
  return draft;
}

export function moveStep(workflow, index, direction) {
  const destination = index + direction;
  if (!Number.isInteger(index) || ![-1, 1].includes(direction) || index < 0 || destination < 0 ||
      index >= workflow.steps.length || destination >= workflow.steps.length) {
    throw new RangeError('Step cannot move outside the workflow');
  }
  const draft = clone(workflow);
  [draft.steps[index], draft.steps[destination]] = [draft.steps[destination], draft.steps[index]];
  return draft;
}

export function updateStep(workflow, index, patch) {
  if (!Number.isInteger(index) || index < 0 || index >= workflow.steps.length ||
      !patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(key => !['id', 'action', 'input', 'when', 'retry'].includes(key))) {
    throw new TypeError('Invalid step edit');
  }
  const draft = clone(workflow);
  // Explicit undefined removes an optional field (e.g. condition/retry toggle).
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete draft.steps[index][key];
    else draft.steps[index][key] = clone(value);
  }
  return draft;
}

export function setTriggerType(workflow, type) {
  if (type !== 'event' && type !== 'interval') throw new TypeError('Unsupported trigger type');
  const draft = clone(workflow);
  draft.triggers = type === 'event'
    ? [{ type: 'event', name: 'event.received' }]
    : [{ type: 'interval', everyMs: 3600000, anchorAt: '2026-01-01T00:00:00.000Z' }];
  return draft;
}

export function workflowIssues(workflow, catalog, payload, online) {
  try { return { report: previewWorkflow(workflow, { actions: catalog, payload, online }), error: null }; }
  catch { return { report: null, error: 'Workflow validation failed. Check identifiers, trigger, conditions, and retry settings.' }; }
}
