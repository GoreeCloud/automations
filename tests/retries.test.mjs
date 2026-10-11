import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine, MemoryStore } from '../src/engine.mjs';
import { EncryptedFileStore, StoreIntegrityError } from '../src/encrypted-file-store.mjs';

const definition = (retry = {maxAttempts:3,backoffMs:1000}) => ({
  id:'delivery', version:1, name:'Delivery', enabled:true,
  triggers:[{type:'event',name:'created'}],
  steps:[{id:'send',action:'host.deliver',retry}]
});
const engine = (store = new MemoryStore(), options = {}) => new WorkflowEngine({
  store, online:() => true, authorize:async () => true,
  now:() => '2026-10-11T16:00:00.000Z', ...options
});
async function inDirectory(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'goreecloud-retries-'));
  try { await fn(directory); }
  finally { await rm(directory,{recursive:true,force:true}); }
}

test('bounded replay-safe retries use a stable key and exponential UTC deadlines',async () => {
  let clock='2026-10-11T16:00:00.000Z', attempts=[];
  const e=engine(undefined,{now:() => clock});
  e.registerWorkflow(definition());
  e.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
    execute:async ({idempotencyKey}) => {
      attempts.push(idempotencyKey);
      if(attempts.length<3) throw Error('confidential transient failure');
    }
  });
  const first=await e.run('delivery',{eventId:'message1'});
  assert.equal(first.status,'waiting_retry');
  assert.equal(first.retryAt,'2026-10-11T16:00:01.000Z');
  assert.equal(first.attempt,1);
  assert.equal(JSON.stringify(first).includes('confidential transient failure'),false);
  assert.equal((await e.resumeRetry(first.id,'2026-10-11T16:00:00.999Z')).status,'waiting_retry');
  clock='2026-10-11T16:00:01.000Z';
  const next=(await e.resumeDue(clock))[0];
  assert.equal(next.retryAt,'2026-10-11T16:00:03.000Z');
  clock=next.retryAt;
  assert.equal((await e.resumeDue(clock))[0].status,'succeeded');
  assert.deepEqual(attempts,Array(3).fill('delivery:message1:send'));
  assert.equal((await e.resumeDue(clock)).length,0);
});

test('retry policy blocks non-idempotent host before first action',async () => {
  let calls=0;
  const e=engine();
  e.registerWorkflow(definition());
  e.registerAction('host.deliver',{capability:'delivery.write',execute:async () => calls++});
  const job=await e.run('delivery',{eventId:'unsafe'});
  assert.equal(job.status,'blocked');
  assert.equal(job.errorCode,'RETRY_NOT_SAFE');
  assert.equal(calls,0);
});

test('exhausted retries become terminal and cannot repeat',async () => {
  let clock='2026-10-11T16:00:00.000Z',calls=0;
  const e=engine(undefined,{now:() => clock});
  e.registerWorkflow(definition({maxAttempts:2,backoffMs:1000}));
  e.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
    execute:async () => {calls++;throw Error('unavailable')}
  });
  const first=await e.run('delivery',{eventId:'exhaust'});
  clock=first.retryAt;
  assert.equal((await e.resumeRetry(first.id,clock)).status,'failed');
  assert.equal((await e.resumeRetry(first.id,clock)).status,'failed');
  assert.equal(calls,2);
});

test('queued retry cancellation and telemetry failures do not repeat side effects',async () => {
  let calls=0;
  const e=engine(undefined,{onTransition:() => {throw Error('telemetry')}}); 
  e.registerWorkflow(definition());
  e.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
    execute:async () => {calls++;throw Error('failed')}
  });
  const first=await e.run('delivery',{eventId:'cancel'});
  assert.equal(first.status,'waiting_retry');
  assert.equal((await e.cancel(first.id)).status,'cancelled');
  assert.equal((await e.resumeRetry(first.id,'2026-10-11T17:00:00.000Z')).status,'cancelled');
  assert.equal(calls,1);
});

test('invalid retry definitions and due times fail validation',async () => {
  const e=engine();
  for(const retry of [{maxAttempts:7,backoffMs:1000},{maxAttempts:1,backoffMs:1000},
    {maxAttempts:2,backoffMs:-1},{maxAttempts:2,backoffMs:1.5},null]) {
    assert.throws(() => e.registerWorkflow(definition(retry)),TypeError);
  }
  await assert.rejects(() => e.dueRetries('invalid'),TypeError);
  await assert.rejects(() => e.resumeRetry('delivery:invalid','invalid'),TypeError);
});

test('queued retry checks authorization again',async () => {
  let allow=true,calls=0;
  const e=engine(undefined,{authorize:async () => allow});
  e.registerWorkflow(definition());
  e.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
    execute:async () => {calls++;throw Error('unavailable')}
  });
  const first=await e.run('delivery',{eventId:'revoked'});
  allow=false;
  const result=await e.resumeRetry(first.id,first.retryAt);
  assert.equal(result.status,'blocked');
  assert.equal(result.errorCode,'AUTHORIZATION_DENIED');
  assert.equal(calls,1);
});

test('encrypted retry survives close and reopen',async () => {
  await inDirectory(async directory => {
    const key=randomBytes(32);
    let clock='2026-10-11T16:00:00.000Z',count=0;
    let store=await EncryptedFileStore.open({directory,key});
    const e1=engine(store,{now:() => clock});
    e1.registerWorkflow(definition());
    e1.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
      execute:async () => {count++;throw Error('temporarily offline')}
    });
    const waiting=await e1.run('delivery',{eventId:'survivor'});
    assert.equal(waiting.status,'waiting_retry');
    await store.close();
    store=await EncryptedFileStore.open({directory,key});
    const e2=engine(store,{now:() => clock});
    e2.registerWorkflow(definition());
    e2.registerAction('host.deliver',{capability:'delivery.write',replaySafe:true,
      execute:async () => {count++}
    });
    assert.equal((await e2.dueRetries(clock)).length,0);
    clock=waiting.retryAt;
    assert.equal((await e2.resumeDue(clock))[0].status,'succeeded');
    assert.equal(count,2);
    await store.close();
  });
});

test('recovered retry never executes an adapter that lost replay safety',async () => {
  const store=new MemoryStore(),flow=definition();
  await store.createIfAbsent({
    id:'delivery:interrupted',workflowId:'delivery',eventId:'interrupted',
    cursor:0,status:'waiting_retry',attempt:1,retryAt:'2026-10-11T16:00:01.000Z',
    payload:{},actor:null,stepHistory:[],workflowSnapshot:flow,inflightStepId:'send'
  });
  const e=engine(store);
  e.registerWorkflow(flow);
  e.registerAction('host.deliver',{capability:'delivery.write',replaySafe:false,
    execute:async () => {throw Error('must not execute')}
  });
  const result=await e.resumeRetry('delivery:interrupted','2026-10-11T16:00:02.000Z');
  assert.equal(result.status,'blocked');
  assert.equal(result.errorCode,'RETRY_NOT_SAFE');
});

test('removed encrypted journal fails closed instead of silently becoming empty',async () => {
  await inDirectory(async directory => {
    const key=randomBytes(32);
    const store=await EncryptedFileStore.open({directory,key});
    await store.createIfAbsent({id:'delivery:one',status:'running',cursor:0});
    await rm(join(directory,'jobs.enc'));
    await assert.rejects(() => store.list(),StoreIntegrityError);
    await store.close();
    await assert.rejects(() => EncryptedFileStore.open({directory,key}),StoreIntegrityError);
  });
});

test('tampered initialization marker is rejected without overwriting journal',async () => {
  await inDirectory(async directory => {
    const key=randomBytes(32);
    const store=await EncryptedFileStore.open({directory,key});
    await store.createIfAbsent({id:'delivery:one',status:'running',cursor:0});
    await store.close();
    const file=join(directory,'jobs.enc'),raw=await readFile(file);
    await writeFile(join(directory,'.initialized'),'bad marker');
    await assert.rejects(() => EncryptedFileStore.open({directory,key}),StoreIntegrityError);
    assert.deepEqual(await readFile(file),raw);
  });
});

test('valid unmarked legacy encrypted snapshot migrates in place',async () => {
  await inDirectory(async directory => {
    const key=randomBytes(32);
    let store=await EncryptedFileStore.open({directory,key});
    await store.createIfAbsent({id:'delivery:one',status:'waiting_network',cursor:0});
    await store.close();
    await rm(join(directory,'.initialized'));
    store=await EncryptedFileStore.open({directory,key});
    assert.equal((await store.get('delivery:one')).status,'waiting_network');
    assert.equal(await readFile(join(directory,'.initialized'),'utf8'),'GCA1\n');
    await store.close();
  });
});