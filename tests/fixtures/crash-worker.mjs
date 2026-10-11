/** Test fixture only. Deliberately terminates its own process after a host action. */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkflowEngine } from '../../src/engine.mjs';
import { EncryptedFileStore } from '../../src/encrypted-file-store.mjs';

const [directory, secretHex] = process.argv.slice(2);
if (!directory || !/^[0-9a-f]{64}$/.test(secretHex ?? '')) process.exit(2);
const key = Buffer.from(secretHex, 'hex');
const store = await EncryptedFileStore.open({ directory, key });
const engine = new WorkflowEngine({ store, authorize: async () => true });
const workflow = { id: 'crash', version: 1, name: 'Crash test only', enabled: true,
  triggers: [{type:'event',name:'event.crash'}], steps:[{id:'write',action:'local.write'}] };
engine.registerWorkflow(workflow);
engine.registerAction('local.write', { capability:'files.write', execute: async () => {
  await writeFile(join(directory, 'effect.txt'), 'effect occurred\n');
  process.kill(process.pid, 'SIGKILL');
  throw Error('unreachable');
}});
await engine.run('crash',{eventId:'effect1'});
process.exit(3);
