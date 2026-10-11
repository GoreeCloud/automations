import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadStarters, selectStarter } from '../web/editor-state.mjs';

const libraryURL = new URL('../examples/starter-templates.json', import.meta.url);
const catalogURL = new URL('../examples/action-catalog.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogURL, 'utf8'));
const raw = JSON.parse(await readFile(libraryURL, 'utf8'));

test('starter library has three valid disabled workflows', () => {
  const library = loadStarters(raw, catalog);
  assert.equal(library.length, 3);
  assert.ok(library.every(entry => entry.workflow.enabled === false));
  assert.equal(selectStarter(library, 'quick-capture', catalog).triggers[0].type, 'event');
  assert.equal(selectStarter(library, 'hourly-reminder', catalog).triggers[0].type, 'interval');
});

test('starter definitions are cloned and cannot grant permissions or execute', () => {
  const library = loadStarters(raw, catalog);
  const draft = selectStarter(library, 'optional-delivery', catalog);
  assert.equal(draft.enabled, false);
  assert.deepEqual(draft.steps.map(step => step.action), ['local.note', 'remote.send']);
  draft.steps[0].input.title = 'changed';
  assert.notEqual(selectStarter(library, 'optional-delivery', catalog).steps[0].input.title, 'changed');
  assert.throws(() => selectStarter(library, 'missing', catalog), RangeError);
});

test('starter validation rejects duplicated IDs and enabled or malformed workflows', () => {
  assert.throws(() => loadStarters([], catalog), TypeError);
  assert.throws(() => loadStarters([raw[0], raw[0]], catalog), TypeError);
  assert.throws(() => loadStarters([{...raw[0], workflow: {...raw[0].workflow, enabled: true}}], catalog), TypeError);
  assert.throws(() => loadStarters([{...raw[0], workflow: {...raw[0].workflow, triggers: []}}], catalog), TypeError);
});
