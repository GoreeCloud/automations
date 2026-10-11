import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine, MemoryStore } from '../src/engine.mjs';

const definition = (steps, id = 'morning') => ({ id, version: 1, name: 'Morning', enabled: true,
  triggers: [{ type: 'event', name: 'alarm.dismissed' }], steps });
const actionStep = (id, action = 'local.note', extra = {}) => ({ id, action, ...extra });
const setup = (overrides = {}) => new WorkflowEngine({ online: () => false,
  authorize: async () => true, ...overrides });

test('local actions execute offline once for duplicate event IDs', async () => {
  let calls = 0;
  const e = setup();
  e.registerAction('local.note', { capability: 'notes.write', execute: async ({ idempotencyKey }) => {
    assert.equal(idempotencyKey, 'morning:event-1:save'); calls++;
  }});
  e.registerWorkflow(definition([actionStep('save')]));
  const [first] = await e.emit('alarm.dismissed', 'event-1', { title: 'hello' });
  const [second] = await e.emit('alarm.dismissed', 'event-1', { title: 'changed' });
  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.equal(calls, 1);
});

test('network step defers while offline and resumes when online without repeating local steps', async () => {
  let online = false;
  const calls = [];
  const e = setup({ online: () => online });
  e.registerAction('local.note', { capability: 'notes.write', execute: async () => calls.push('local') });
  e.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true,
    execute: async () => calls.push('remote') });
  e.registerWorkflow(definition([actionStep('save'), actionStep('send', 'remote.send')]));
  const first = await e.run('morning', { eventId: 'evt2' });
  assert.equal(first.status, 'waiting_network');
  assert.deepEqual(calls, ['local']);
  assert.equal((await e.pending()).length, 1);
  online = true;
  const done = await e.resume(first.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(calls, ['local', 'remote']);
  assert.equal((await e.pending()).length, 0);
});

test('authorization is deny-by-default and fails closed', async () => {
  let calls = 0;
  const e = new WorkflowEngine();
  e.registerAction('local.note', { capability: 'notes.write', execute: async () => calls++ });
  e.registerWorkflow(definition([actionStep('save')]));
  const job = await e.run('morning', { eventId: 'denied' });
  assert.equal(job.status, 'blocked');
  assert.equal(job.errorCode, 'AUTHORIZATION_DENIED');
  assert.equal(calls, 0);
});

test('conditional steps do not run when payload does not match', async () => {
  let calls = 0;
  const e = setup();
  e.registerAction('local.note', { capability: 'notes.write', execute: async () => calls++ });
  e.registerWorkflow(definition([actionStep('skip', 'local.note',
    { when: { path: 'payload.weather.rain', op: 'eq', value: true } }), actionStep('run')]));
  const job = await e.run('morning', { eventId: 'condition', payload: { weather: { rain: false } } });
  assert.equal(job.status, 'succeeded');
  assert.equal(job.stepHistory[0].status, 'skipped');
  assert.equal(calls, 1);
});

test('unknown actions and action failures do not get reported as successful', async () => {
  const e = setup();
  e.registerWorkflow(definition([actionStep('bad', 'missing.action')]));
  assert.equal((await e.run('morning', { eventId: 'unknown' })).errorCode, 'ACTION_UNAVAILABLE');
  e.registerAction('local.note', { capability: 'notes.write', execute: async () => { throw Error('private secret'); } });
  e.registerWorkflow(definition([actionStep('fail')]));
  const job = await e.run('morning', { eventId: 'failure' });
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'ACTION_FAILED');
  assert.ok(!JSON.stringify(job).includes('private secret'));
});

test('malformed and prototype traversal conditions are rejected', () => {
  const e = setup();
  assert.throws(() => e.registerWorkflow(definition([actionStep('a', 'local.note',
    { when: { path: 'payload.__proto__.admin', op: 'eq', value: true } })])));
  assert.throws(() => e.registerWorkflow(definition([actionStep('a'), actionStep('a')])));
});

test('in-flight deduplication prevents concurrent duplicate dispatch within one engine', async () => {
  let calls = 0;
  const e = setup({store: new MemoryStore()});
  e.registerAction('local.note', { capability: 'notes.write', execute: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5));
  }});
  e.registerWorkflow(definition([actionStep('save')]));
  await Promise.all(Array.from({length: 6}, () => e.run('morning', {eventId: 'same'})));
  assert.equal(calls, 1);
});

test('UTC interval trigger executes latest due slot only, with stable deduplication', async () => {
  const observations = [];
  const e = setup();
  e.registerAction('local.note', { capability: 'notes.write', execute: async ({ payload, idempotencyKey }) => {
    observations.push({ at: payload.scheduledAt, key: idempotencyKey });
  }});
  e.registerWorkflow({ id: 'hourly', version: 1, name: 'Hourly', enabled: true,
    triggers: [{ type: 'interval', everyMs: 60_000, anchorAt: '2026-10-11T00:00:00.000Z' }],
    steps: [actionStep('save')] });
  assert.deepEqual(await e.tick('2026-10-10T23:59:59.999Z'), []);
  const [first] = await e.tick('2026-10-11T00:05:10.000Z');
  assert.equal(first.id, 'hourly:interval-0-1791677100000');
  assert.equal(first.status, 'succeeded');
  await e.tick('2026-10-11T00:05:59.999Z');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].at, '2026-10-11T00:05:00.000Z');
  const [second] = await e.tick('2026-10-11T00:06:01.000Z');
  assert.equal(second.status, 'succeeded');
  assert.equal(observations.length, 2);
  assert.equal(observations[1].at, '2026-10-11T00:06:00.000Z');
  assert.ok(observations.every(x => x.key.endsWith(':save')));
});

test('interval validation rejects invalid calendars, short intervals and malformed ticks', async () => {
  const e = setup();
  const make = trigger => ({ id: 'timer', version: 1, name: 'Timer', enabled: true,
    triggers: [trigger], steps: [actionStep('save')] });
  assert.throws(() => e.registerWorkflow(make({ type: 'interval', everyMs: 1,
    anchorAt: '2026-10-11T00:00:00.000Z' })), TypeError);
  assert.throws(() => e.registerWorkflow(make({ type: 'interval', everyMs: 60_000,
    anchorAt: '2026-02-30T00:00:00.000Z' })), TypeError);
  assert.throws(() => e.registerWorkflow(make({ type: 'interval', everyMs: 60_000,
    anchorAt: '2026-10-11T00:00:00-05:00' })), TypeError);
  await assert.rejects(() => e.tick('not-a-time'), TypeError);
});

test('bulk resume and cancellation preserve deferred network work boundaries', async () => {
  let online = false;
  const e = setup({ online: () => online });
  const outputs = [];
  e.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true,
    execute: async ({ idempotencyKey }) => outputs.push(idempotencyKey) });
  e.registerWorkflow(definition([actionStep('send', 'remote.send')]));
  const waitingA = await e.run('morning', { eventId: 'a' });
  const waitingB = await e.run('morning', { eventId: 'b' });
  assert.equal(waitingA.status, 'waiting_network');
  assert.equal((await e.cancel(waitingA.id)).status, 'cancelled');
  assert.equal((await e.resume(waitingA.id)).status, 'cancelled');
  assert.equal((await e.resumePending())[0].status, 'waiting_network');
  assert.deepEqual(outputs, []);
  online = true;
  const [finished] = await e.resumePending();
  assert.equal(finished.id, waitingB.id);
  assert.equal(finished.status, 'succeeded');
  assert.deepEqual(outputs, ['morning:b:send']);
  assert.equal((await e.cancel(waitingB.id)).status, 'succeeded');
  assert.deepEqual(await e.pending(), []);
});
