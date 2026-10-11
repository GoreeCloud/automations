import test from 'node:test';
import assert from 'node:assert/strict';
import { request as requestHTTP } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  createDraft, validateDraft, importDraft, exportDraft, appendStep,
  removeStep, moveStep, updateStep, setTriggerType, workflowIssues,
} from '../web/editor-state.mjs';
import { makeEditorServer } from '../bin/serve-editor.mjs';

const catalog = {
  'local.note': { capability: 'notes.write', requiresNetwork: false, replaySafe: false },
  'remote.send': { capability: 'mail.send', requiresNetwork: true, replaySafe: true },
};

test('editor starts disabled with no capabilities or network execution', () => {
  const draft = createDraft();
  assert.equal(draft.enabled, false);
  assert.equal(draft.steps.length, 1);
  const report = validateDraft(draft, catalog);
  assert.equal(report.sideEffectsExecuted, false);
  assert.equal(report.authorizationGranted, false);
  assert.deepEqual(report.steps.map(s => s.decision), ['disabled']);
});

test('add, reorder and remove steps preserve input and do not mutate original workflow', () => {
  const original = createDraft();
  const expanded = appendStep(original, 'remote.send');
  assert.equal(original.steps.length, 1);
  assert.deepEqual(expanded.steps.map(s => s.id), ['step-1', 'step-2']);
  const moved = moveStep(expanded, 1, -1);
  assert.equal(moved.steps[0].action, 'remote.send');
  assert.equal(expanded.steps[0].action, 'local.note');
  const reduced = removeStep(moved, 1);
  assert.equal(reduced.steps.length, 1);
  assert.throws(() => removeStep(reduced, 0), RangeError);
  assert.throws(() => moveStep(reduced, 0, 1), RangeError);
});

test('step edits may toggle conditions and retries without accidentally changing workflow authority', () => {
  const draft = createDraft();
  const changed = updateStep(draft, 0, { when: { op: 'eq', path: 'payload.ok', value: true }, retry: { maxAttempts: 2, backoffMs: 1000 } });
  assert.equal(draft.steps[0].when, undefined);
  const enabled = { ...changed, enabled: true };
  assert.equal(workflowIssues(enabled, catalog, { ok: true }, false).report.steps[0].decision, 'unsafe_retry');
  const safe = updateStep(changed, 0, { retry: undefined });
  assert.equal(safe.steps[0].retry, undefined);
  assert.equal(workflowIssues({ ...safe, enabled: true }, catalog, { ok: false }, false).report.steps[0].decision, 'skipped');
});

test('authoring can change trigger from event to interval and validate both variants', () => {
  const draft = createDraft();
  const interval = setTriggerType(draft, 'interval');
  assert.equal(interval.triggers[0].everyMs, 3600000);
  assert.doesNotThrow(() => validateDraft(interval, catalog));
  const event = setTriggerType(interval, 'event');
  assert.equal(event.triggers[0].name, 'event.received');
  assert.throws(() => setTriggerType(draft, 'script'));
});

test('JSON import/export roundtrip and invalid inputs fail closed', () => {
  const original = createDraft();
  const serialized = exportDraft(original, catalog);
  assert.deepEqual(importDraft(serialized, catalog), original);
  assert.throws(() => importDraft('{not-json}', catalog));
  assert.throws(() => importDraft(JSON.stringify({ ...original, version: 2 }), catalog));
  assert.throws(() => importDraft('x'.repeat(256 * 1024 + 1), catalog));
  assert.throws(() => exportDraft({ ...original, id: '../danger' }, catalog));
  const result = workflowIssues({ ...original, triggers: [] }, catalog, {}, false);
  assert.equal(result.report, null);
  assert.ok(result.error);
});

test('local preview flags offline and unavailable action metadata without execution', () => {
  const draft = appendStep(createDraft(), 'remote.send');
  const enabled = { ...draft, enabled: true };
  assert.deepEqual(workflowIssues(enabled, catalog, {}, false).report.steps.map(s => s.decision),
    ['authorization_required', 'waiting_network']);
  assert.deepEqual(workflowIssues(enabled, {}, {}, false).report.steps.map(s => s.decision),
    ['unavailable', 'unavailable']);
});

function fetchPort(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = requestHTTP({ hostname: '127.0.0.1', port, method, path }, response => {
      const parts = [];
      response.on('data', p => parts.push(p));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('loopback editor serves only allowed local assets and denies mutation and path traversal', async () => {
  const server = makeEditorServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const page = await fetchPort(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /GoreeCloud Automations/);
    assert.match(page.body, /\/web\/editor.mjs/);
    assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    for (const path of ['/web/editor.mjs', '/web/editor-state.mjs', '/src/engine.mjs', '/examples/action-catalog.json']) {
      assert.equal((await fetchPort(port, path)).status, 200, path);
    }
    assert.equal((await fetchPort(port, '/.env')).status, 404);
    assert.equal((await fetchPort(port, '/src/encrypted-file-store.mjs')).status, 404);
    assert.equal((await fetchPort(port, '/../package.json')).status, 404);
    assert.equal((await fetchPort(port, '/?x=anything', 'POST')).status, 405);
    assert.equal((await fetchPort(port, '/', 'HEAD')).body, '');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('editor has labeled inputs, live status, and user-initiated import/export and preview controls', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const id of ['workflow-name','workflow-id','workflow-enabled','trigger-type','step-list',
    'preview-payload','preview-button','status','import-workflow','export-workflow']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Skip to workflow editor/);
  assert.doesNotMatch(html, /https?:\/\//); // No remote dependencies at runtime
});
