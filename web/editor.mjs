import {
  createDraft, validateDraft, importDraft, exportDraft, appendStep,
  removeStep, moveStep, updateStep, setTriggerType, workflowIssues,
  createHistory, recordHistory, undoHistory, redoHistory, loadStarters, selectStarter,
} from './editor-state.mjs';

const $ = id => document.getElementById(id);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_INPUT_CHARS = 8192;
let history = createHistory(createDraft());
let workflow = history.present;
let catalog = {};
let starters = [];
let unsaved = false;
const invalidJsonFields = new Set();

function notice(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function renderHistory() {
  $('undo-workflow').disabled = history.past.length === 0;
  $('redo-workflow').disabled = history.future.length === 0;
}

function commitWorkflow(next, group = null) {
  history = recordHistory(history, next, group);
  workflow = history.present;
  unsaved = true;
  renderStatus();
}

function restoreHistory(direction) {
  const updated = direction === 'undo' ? undoHistory(history) : redoHistory(history);
  if (updated === history) return;
  history = updated;
  workflow = history.present;
  invalidJsonFields.clear();
  unsaved = true; // Undoing an edit does not overwrite the user's last exported file.
  $('preview-output').replaceChildren();
  render();
  notice(`${direction === 'undo' ? 'Undid' : 'Redid'} workflow edit. Export JSON to save. No actions have run.`);
}

function renderStatus() {
  const { error } = workflowIssues(workflow, catalog, {}, false);
  const invalid = Boolean(error || invalidJsonFields.size);
  $('export-workflow').disabled = invalid;
  renderHistory();
  if (invalid) notice('Invalid definition. Fix the highlighted field or check workflow identifiers and step settings.', true);
  else notice(unsaved ? 'Unsaved definition. Export JSON to keep your changes. No actions have run.' : 'Ready. No actions have run.');
}

function edit(patch, group = null) {
  commitWorkflow({ ...workflow, ...patch }, group);
}

function labelWith(controlText, control, className = '') {
  const label = document.createElement('label');
  label.textContent = controlText;
  if (className) label.className = className;
  label.append(control);
  return label;
}

function inputText(value, onChange, { type = 'text', maxLength, min, max, step } = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  if (maxLength) input.maxLength = maxLength;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function updateAt(index, patch, rerender = false, group = null) {
  try {
    commitWorkflow(updateStep(workflow, index, patch), group);
    if (rerender) renderSteps(index);
  } catch { notice('Step edit rejected by validation.', true); }
}

function checkLine(text, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

function selectOptions(items, value, onChange) {
  const sel = document.createElement('select');
  for (const [id, name] of items) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    sel.append(opt);
  }
  if (![...sel.options].some(o => o.value === value)) {
    const missing = document.createElement('option');
    missing.value = value;
    missing.textContent = `${value} (unavailable)`;
    sel.append(missing);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function renderSteps(focusIndex = null) {
  const list = $('step-list');
  list.replaceChildren();
  $('step-count').textContent = `(${workflow.steps.length})`;
  const availableActions = Object.keys(catalog).sort().map(key => [key, key]);

  workflow.steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'step';
    item.tabIndex = -1;
    const header = document.createElement('div');
    header.className = 'step-title';
    const indexSpan = document.createElement('span');
    indexSpan.className = 'step-index';
    indexSpan.textContent = `Step ${index + 1}`;
    const tools = document.createElement('div');
    tools.className = 'step-tools';
    for (const [label, symbol, disabled, handler] of [
      ['Move step up', '↑', index === 0, () => moveStep(workflow, index, -1)],
      ['Move step down', '↓', index === workflow.steps.length - 1, () => moveStep(workflow, index, 1)],
      ['Delete step', '×', workflow.steps.length <= 1, () => removeStep(workflow, index)],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = symbol;
      button.setAttribute('aria-label', `${label} ${index + 1}`);
      button.disabled = disabled;
      button.addEventListener('click', () => {
        if (invalidJsonFields.size) { notice('Fix invalid JSON before moving or deleting steps.', true); return; }
        commitWorkflow(handler());
        renderSteps(Math.min(index + (label === 'Move step down' ? 1 : label === 'Move step up' ? -1 : 0), workflow.steps.length - 1));
      });
      tools.append(button);
    }
    header.append(indexSpan, tools);
    const fields = document.createElement('div');
    fields.className = 'step-fields';
    fields.append(
      labelWith('Step ID', inputText(step.id, value => updateAt(index, { id: value }, false, `step:${index}:id`), { maxLength: 128 })),
      labelWith('Action', selectOptions(availableActions, step.action, value => updateAt(index, { action: value }))),
    );
    const inputArea = document.createElement('textarea');
    inputArea.rows = 3;
    inputArea.maxLength = MAX_INPUT_CHARS;
    inputArea.spellcheck = false;
    inputArea.value = JSON.stringify(step.input ?? {}, null, 2);
    inputArea.addEventListener('input', () => {
      try {
        const value = JSON.parse(inputArea.value);
        invalidJsonFields.delete(`input:${index}`);
        updateAt(index, { input: value }, false, `step:${index}:input`);
      } catch {
        invalidJsonFields.add(`input:${index}`);
        $('export-workflow').disabled = true;
        notice(`Step ${index + 1}: action input is not valid JSON.`, true);
      }
    });
    fields.append(labelWith('Action input (JSON)', inputArea, 'wide'));
    item.append(header, fields);

    const options = document.createElement('div');
    options.className = 'step-options';
    options.append(checkLine('Add condition', Boolean(step.when), checked => updateAt(index, {
      when: checked ? { path: 'payload.approved', op: 'eq', value: true } : undefined,
    }, true)));
    options.append(checkLine('Retry on failure', Boolean(step.retry), checked => updateAt(index, {
      retry: checked ? { maxAttempts: 2, backoffMs: 1000 } : undefined,
    }, true)));
    item.append(options);

    if (step.when) {
      const condition = document.createElement('div');
      condition.className = 'step-fields step-extra';
      condition.append(
        labelWith('Payload property', inputText(step.when.path, value => updateAt(index, {
          when: { ...step.when, path: value },
        }))),
        labelWith('Comparison', selectOptions([['eq', 'Equals'], ['ne', 'Not equals'], ['exists', 'Exists']], step.when.op,
          value => updateAt(index, { when: { ...step.when, op: value } }, true))),
      );
      if (step.when.op !== 'exists') {
        const valueInput = inputText(JSON.stringify(step.when.value ?? null), raw => {
          try {
            const value = JSON.parse(raw);
            invalidJsonFields.delete(`when:${index}`);
            updateAt(index, { when: { ...workflow.steps[index].when, value } });
          } catch { invalidJsonFields.add(`when:${index}`); $('export-workflow').disabled = true; notice('Condition comparison must be valid JSON.', true); }
        });
        condition.append(labelWith('Comparison value (JSON)', valueInput, 'wide'));
      }
      item.append(condition);
    }

    if (step.retry) {
      const retry = document.createElement('div');
      retry.className = 'step-fields step-extra';
      retry.append(
        labelWith('Max attempts (2–6)', inputText(step.retry.maxAttempts, value => updateAt(index, {
          retry: { ...step.retry, maxAttempts: Number(value) },
        }), { type: 'number', min: 2, max: 6, step: 1 })),
        labelWith('Initial delay (ms)', inputText(step.retry.backoffMs, value => updateAt(index, {
          retry: { ...step.retry, backoffMs: Number(value) },
        }), { type: 'number', min: 1000, max: 3600000, step: 1000 })),
      );
      item.append(retry);
    }
    list.append(item);
  });
  if (Number.isInteger(focusIndex)) list.children[focusIndex]?.focus();
}

function showPreview(report) {
  const output = $('preview-output');
  const heading = document.createElement('h3');
  heading.textContent = `Preview · ${report.steps.length} steps`;
  const list = document.createElement('ol');
  list.className = 'preview-list';
  for (const step of report.steps) {
    const row = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = step.stepId;
    const badge = document.createElement('span');
    badge.className = `decision ${step.decision}`;
    badge.textContent = step.decision.replaceAll('_', ' ');
    const meta = document.createElement('small');
    meta.textContent = `${step.action}${step.capability ? ` · ${step.capability}` : ''}`;
    row.append(strong, badge, meta);
    list.append(row);
  }
  output.replaceChildren(heading, list);
}

function render() {
  $('workflow-name').value = workflow.name;
  $('workflow-id').value = workflow.id;
  $('workflow-enabled').checked = workflow.enabled;
  const trigger = workflow.triggers[0];
  $('trigger-type').value = trigger.type;
  const interval = trigger.type === 'interval';
  $('event-name-control').hidden = interval;
  $('interval-duration-control').hidden = !interval;
  $('interval-anchor-control').hidden = !interval;
  $('event-name').value = interval ? '' : trigger.name;
  $('interval-minutes').value = interval ? String(trigger.everyMs / 60000) : '60';
  $('interval-anchor').value = interval ? trigger.anchorAt : '2026-01-01T00:00:00.000Z';
  renderSteps();
  renderStatus();
}

async function init() {
  try {
    const response = await fetch('/examples/action-catalog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Missing action metadata');
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action metadata');
    catalog = value;
    validateDraft(workflow, catalog);
  } catch {
    catalog = {};
    notice('Action catalog is unavailable; preview cannot validate action metadata.', true);
  }
  // Starters remain inert JSON definitions; no execution or permission grant.
  try {
    const response = await fetch('/examples/starter-templates.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Templates unavailable');
    starters = loadStarters(await response.json(), catalog);
    const picker = $('starter-choice');
    for (const entry of starters) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      option.title = entry.description;
      picker.append(option);
    }
    $('load-starter').disabled = false;
  } catch {
    $('load-starter').disabled = true;
    notice('Starter templates unavailable. You can still create or import workflows.', true);
  }
  $('load-starter').addEventListener('click', () => {
    if (unsaved && !window.confirm('Replace this unexported definition with a starter?')) return;
    try {
      history = createHistory(selectStarter(starters, $('starter-choice').value, catalog));
      workflow = history.present;
      unsaved = false;
      invalidJsonFields.clear();
      $('preview-output').replaceChildren();
      render();
      notice('Starter loaded disabled. Edit and preview before export; no actions have run.');
    } catch { notice('Starter could not be loaded; existing workflow preserved.', true); }
  });
  $('workflow-name').addEventListener('input', e => edit({ name: e.target.value }, 'workflow:name'));
  $('workflow-id').addEventListener('input', e => edit({ id: e.target.value }, 'workflow:id'));
  $('workflow-enabled').addEventListener('change', e => edit({ enabled: e.target.checked }));
  $('trigger-type').addEventListener('change', e => {
    commitWorkflow(setTriggerType(workflow, e.target.value));
    render();
  });
  $('event-name').addEventListener('input', e => edit({ triggers: [{ type: 'event', name: e.target.value }] }, 'trigger:event'));
  $('interval-minutes').addEventListener('input', e => edit({ triggers: [{ ...workflow.triggers[0], everyMs: Number(e.target.value) * 60000 }] }, 'trigger:minutes'));
  $('interval-anchor').addEventListener('input', e => edit({ triggers: [{ ...workflow.triggers[0], anchorAt: e.target.value }] }, 'trigger:anchor'));
  $('add-step').addEventListener('click', () => {
    if (invalidJsonFields.size) { notice('Fix invalid JSON before adding or reordering steps.', true); return; }
    try { commitWorkflow(appendStep(workflow, Object.keys(catalog)[0] ?? 'local.note')); renderSteps(workflow.steps.length - 1); }
    catch { notice('Step limit reached.', true); }
  });
  $('undo-workflow').addEventListener('click', () => restoreHistory('undo'));
  $('redo-workflow').addEventListener('click', () => restoreHistory('redo'));
  document.addEventListener('keydown', event => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
    const target = event.target;
    // Preserve native text-field undo, including IME composition.
    if (event.isComposing || target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      const redo = key === 'y' || event.shiftKey;
      event.preventDefault();
      restoreHistory(redo ? 'redo' : 'undo');
    }
  });
  $('new-workflow').addEventListener('click', () => {
    if (unsaved && !window.confirm('Discard this unexported definition?')) return;
    history = createHistory(createDraft());
    workflow = history.present;
    unsaved = false;
    invalidJsonFields.clear();
    $('preview-output').replaceChildren();
    render();
  });
  $('import-workflow').addEventListener('click', () => $('workflow-file').click());
  $('workflow-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { notice('Workflow JSON exceeds 256 KiB.', true); return; }
    if (unsaved && !window.confirm('Replace this unexported definition?')) return;
    try {
      history = createHistory(importDraft(await file.text(), catalog));
      workflow = history.present;
      unsaved = false;
      invalidJsonFields.clear();
      $('preview-output').replaceChildren();
      render();
      notice('Workflow imported and validated. No actions have run.');
    } catch { notice('Workflow import failed validation. Existing definition was preserved.', true); }
  });
  $('export-workflow').addEventListener('click', () => {
    if (invalidJsonFields.size) { notice('Resolve invalid JSON fields before exporting.', true); return; }
    try {
      const blob = new Blob([exportDraft(workflow, catalog)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${workflow.id}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
      unsaved = false;
      notice('Workflow JSON prepared locally. Importing into a host still requires explicit permissions.');
    } catch { notice('Workflow could not be exported; correct validation issues.', true); }
  });
  $('preview-button').addEventListener('click', () => {
    let payload;
    try {
      payload = JSON.parse($('preview-payload').value);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Object needed');
    } catch { notice('Preview payload must be a JSON object.', true); $('preview-output').replaceChildren(); return; }
    if (invalidJsonFields.size) { notice('Fix invalid step JSON before preview.', true); return; }
    const { report, error } = workflowIssues(workflow, catalog, payload, $('preview-online').checked);
    if (error) { notice(error, true); $('preview-output').replaceChildren(); return; }
    showPreview(report);
    notice('Safe preview complete. Zero actions executed and zero permissions granted.');
  });
  render();
}

init();
