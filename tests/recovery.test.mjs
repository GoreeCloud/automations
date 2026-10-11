import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileStore, StoreIntegrityError } from '../src/encrypted-file-store.mjs';
import { WorkflowEngine, MemoryStore } from '../src/engine.mjs';

const definition = (steps) => ({ id: 'morning', name: 'Morning', version: 1, enabled: true,
  triggers: [{ type: 'event', name: 'alarm.dismissed' }], steps });
const local = { id: 'save', action: 'local.note', input: { title: 'morning' } };
const remote = { id: 'send', action: 'remote.send' };
const createEngine = (store, online = () => false) => new WorkflowEngine({
  store, online, authorize: async ({ capability }) => ['notes.write', 'mail.send'].includes(capability),
});

async function withDirectory(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'goreecloud-automations-test-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('encrypted store survives restart, preserves offline cursor and prevents duplicate dispatch', async () => {
  await withDirectory(async directory => {
    const key = randomBytes(32);
    let store = await EncryptedFileStore.open({ directory, key });
    let sendCount = 0, noteCount = 0;
    const e1 = createEngine(store);
    e1.registerWorkflow(definition([local, remote]));
    e1.registerAction('local.note', { capability: 'notes.write', replaySafe: true, execute: async () => noteCount++ });
    e1.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true, replaySafe: true, execute: async () => sendCount++ });
    const waiting = await e1.run('morning', { eventId: 'myevent', payload: { privateTitle: 'SECRETPAYLOAD' } });
    assert.equal(waiting.status, 'waiting_network');
    const encrypted = await readFile(join(directory, 'jobs.enc'));
    assert.equal(encrypted.includes(Buffer.from('SECRETPAYLOAD')), false);
    assert.equal(encrypted.includes(Buffer.from('morning:myevent')), false);
    await store.close();

    store = await EncryptedFileStore.open({ directory, key });
    const e2 = createEngine(store, () => true);
    e2.registerWorkflow(definition([local, remote]));
    e2.registerAction('local.note', { capability: 'notes.write', replaySafe: true, execute: async () => noteCount++ });
    e2.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true, replaySafe: true, execute: async () => sendCount++ });
    assert.equal((await e2.pending()).length, 1);
    assert.equal((await e2.resume(waiting.id)).status, 'succeeded');
    assert.equal(noteCount, 1);
    assert.equal(sendCount, 1);
    assert.equal((await e2.run('morning', { eventId: 'myevent' })).status, 'succeeded');
    assert.equal(sendCount, 1);
    await store.close();
  });
});

test('store rejects wrong keys, tampered data, and simultaneous open', async () => {
  await withDirectory(async directory => {
    const key = randomBytes(32);
    let store = await EncryptedFileStore.open({ directory, key });
    await assert.rejects(() => EncryptedFileStore.open({ directory, key }), /STORE_ALREADY_OPEN/);
    await store.createIfAbsent({ id: 'test:evt', status: 'running', cursor: 0 });
    await store.close();
    await assert.rejects(() => EncryptedFileStore.open({ directory, key: randomBytes(32) }), StoreIntegrityError);
    store = await EncryptedFileStore.open({ directory, key });
    await store.close();
    const file = join(directory, 'jobs.enc');
    const raw = await readFile(file); raw[raw.length - 1] ^= 1;
    await writeFile(file, raw);
    await assert.rejects(() => EncryptedFileStore.open({ directory, key }), StoreIntegrityError);
    assert.deepEqual(await readFile(file), raw, 'corrupted state must not be overwritten');
  });
});

test('unknown side-effect outcome is blocked, not automatically retried', async () => {
  const store = new MemoryStore();
  const workflow = definition([local]);
  await store.createIfAbsent({ id: 'morning:maybe-done', workflowId: 'morning', eventId: 'maybe-done',
    payload: {}, actor: null, cursor: 0, status: 'running', inflightStepId: 'save',
    stepHistory: [], workflowSnapshot: workflow });
  let executions = 0;
  const engine = createEngine(store);
  engine.registerWorkflow(workflow);
  engine.registerAction('local.note', { capability: 'notes.write', execute: async () => executions++ });
  const result = await engine.recover('morning:maybe-done');
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorCode, 'ACTION_OUTCOME_UNKNOWN');
  assert.equal(executions, 0);
});

test('explicitly replay-safe steps can recover with stable idempotency key', async () => {
  const store = new MemoryStore();
  const workflow = definition([local]);
  await store.createIfAbsent({ id: 'morning:maybe-done', workflowId: 'morning', eventId: 'maybe-done',
    payload: {}, actor: null, cursor: 0, status: 'running', inflightStepId: 'save',
    stepHistory: [], workflowSnapshot: workflow });
  const keys = [];
  const engine = createEngine(store);
  engine.registerWorkflow(workflow);
  engine.registerAction('local.note', { capability: 'notes.write', replaySafe: true,
    execute: async ({ idempotencyKey }) => keys.push(idempotencyKey) });
  const result = await engine.recover('morning:maybe-done');
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(keys, ['morning:maybe-done:save']);
  assert.equal((await engine.recover('morning:maybe-done')).status, 'succeeded');
  assert.equal(keys.length, 1);
});

test('resuming a paused job uses its original workflow steps, not an edited definition', async () => {
  const store = new MemoryStore();
  const first = createEngine(store);
  first.registerWorkflow(definition([remote]));
  first.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true, execute: async () => {} });
  const paused = await first.run('morning', { eventId: 'original' });
  assert.equal(paused.status, 'waiting_network');
  const second = createEngine(store, () => true);
  second.registerWorkflow(definition([local]));
  let sendCount = 0, saveCount = 0;
  second.registerAction('remote.send', { capability: 'mail.send', requiresNetwork: true, execute: async () => sendCount++ });
  second.registerAction('local.note', { capability: 'notes.write', execute: async () => saveCount++ });
  assert.equal((await second.resume(paused.id)).status, 'succeeded');
  assert.equal(sendCount, 1);
  assert.equal(saveCount, 0);
});

test('store fails closed without 32-byte caller-supplied key', async () => {
  await withDirectory(async directory => {
    await assert.rejects(() => EncryptedFileStore.open({ directory, key: Buffer.alloc(16) }), TypeError);
  });
});
