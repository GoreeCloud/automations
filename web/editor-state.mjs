/** Portable, side-effect-free workflow authoring state. No OS authority or action execution. */
import { previewWorkflow } from '../src/engine.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_BYTES = 256 * 1024;
const MAX_STEPS = 128;

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
