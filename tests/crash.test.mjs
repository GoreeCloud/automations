import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/engine.mjs';
import { EncryptedFileStore } from '../src/encrypted-file-store.mjs';

const supported = process.platform !== 'win32';

test('real process termination after action is checkpointed; unsafe recovery blocks replay',
  { skip: !supported }, async () => {
    const directory = await mkdtemp(join(tmpdir(),'goree-automation-crash-'));
    const key = randomBytes(32);
    try {
      const child = spawnSync(process.execPath,
        ['tests/fixtures/crash-worker.mjs', directory, key.toString('hex')],
        { cwd: new URL('..', import.meta.url), encoding:'utf8', timeout:10_000 });
      assert.equal(child.signal,'SIGKILL', child.stderr);
      assert.equal(await readFile(join(directory,'effect.txt'),'utf8'),'effect occurred\n');
      assert.ok((await stat(join(directory,'.writer.lock'))).isFile());
      // Only the TEST harness knows the owner child is dead. Production must
      // investigate ownership before any manual stale-lock reconciliation.
      await rm(join(directory,'.writer.lock'));
      const store = await EncryptedFileStore.open({directory,key});
      try {
        const pending = (await store.get('crash:effect1'));
        assert.equal(pending.status,'running');
        assert.equal(pending.inflightStepId,'write');
        let replayCount=0;
        const engine = new WorkflowEngine({store,authorize:async()=>true});
        engine.registerWorkflow({ id:'crash',version:1,name:'Crash test only',enabled:true,
          triggers:[{type:'event',name:'event.crash'}],steps:[{id:'write',action:'local.write'}] });
        engine.registerAction('local.write',{capability:'files.write',execute:async()=>replayCount++});
        const result=await engine.recover('crash:effect1');
        assert.equal(result.status,'blocked');
        assert.equal(result.errorCode,'ACTION_OUTCOME_UNKNOWN');
        assert.equal(replayCount,0);
        assert.equal((await readFile(join(directory,'effect.txt'),'utf8')),'effect occurred\n');
      } finally { await store.close(); }
    } finally { await rm(directory,{recursive:true,force:true}); }
});
