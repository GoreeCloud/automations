import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runStarterCLI } from '../bin/starter-cli.mjs';

const call = async args => {
  let stdout = '';
  let stderr = '';
  const code = await runStarterCLI(args, {write: x => { stdout += x; }, fail: x => { stderr += x; }});
  return { code, stdout, stderr };
};

test('starter CLI enumerates immutable, offline-only workflow definitions', async () => {
  const r = await call(['list']);
  assert.equal(r.code, 0);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(x => x.id), ['quick-capture', 'hourly-reminder', 'optional-delivery']);
  assert.equal(rows[1].triggerType, 'interval');
});

test('show returns disabled workflow and preview cannot execute or authorize', async () => {
  const shown = await call(['show', 'optional-delivery']);
  assert.equal(shown.code, 0);
  const workflow = JSON.parse(shown.stdout);
  assert.equal(workflow.enabled, false);
  assert.equal(workflow.steps.length, 2);
  const simulated = await call(['preview', 'optional-delivery', '--online', '--approved']);
  assert.equal(simulated.code, 0);
  const preview = JSON.parse(simulated.stdout);
  assert.equal(preview.simulationOnly, true);
  assert.equal(preview.sourceWorkflowEnabled, false);
  assert.equal(preview.sideEffectsExecuted, false);
  assert.equal(preview.authorizationGranted, false);
  assert.deepEqual(preview.steps.map(x => x.decision), ['authorization_required', 'authorization_required']);
});

test('CLI never reads arbitrary paths or echoes untrusted identifiers on failure', async () => {
  const dangerous = '../secret-token';
  const r = await call(['show', dangerous]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.ok(!r.stderr.includes(dangerous));
  const invalid = await call(['preview', 'quick-capture', '--unsafe']);
  assert.equal(invalid.code, 2);
  const invalidShow = await call(['show']);
  assert.equal(invalidShow.code, 2);
});

test('actual Node CLI entrypoint emits JSON for use by developer tools', () => {
  const r = spawnSync(process.execPath, [new URL('../bin/starter-cli.mjs', import.meta.url).pathname, 'list'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 3);
});
