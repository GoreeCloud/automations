#!/usr/bin/env node
/** Explicit, offline-capable, read-only workflow preflight CLI. No actions run. */
import { readFile } from 'node:fs/promises';
import { previewWorkflow } from '../src/engine.mjs';

function usage() {
  process.stderr.write('Usage: node bin/preview.mjs WORKFLOW.json --catalog ACTIONS.json [--payload DATA.json] [--online]\n');
  process.exitCode = 2;
}
const args = process.argv.slice(2);
if (args.length < 3 || args[0].startsWith('--') || args[1] !== '--catalog' || !args[2]) {
  usage();
} else {
  try {
    if (!['--online', '--payload'].includes(args[3]) && args.length > 3) throw new Error('Invalid argument');
    let online = false;
    let payloadFile = null;
    for (let i = 3; i < args.length; i++) {
      if (args[i] === '--online') online = true;
      else if (args[i] === '--payload' && args[i+1] && !payloadFile) payloadFile = args[++i];
      else throw new Error('Invalid argument');
    }
    const [workflow, actions, payload] = await Promise.all([
      readFile(args[0], 'utf8').then(JSON.parse),
      readFile(args[2], 'utf8').then(JSON.parse),
      payloadFile ? readFile(payloadFile, 'utf8').then(JSON.parse) : Promise.resolve({}),
    ]);
    const report = previewWorkflow(workflow, { actions, payload, online });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch {
    // Avoid echoing paths and untrusted file contents to diagnostic logs.
    process.stderr.write('PREVIEW_FAILED: Invalid workflow, catalog, payload, or CLI arguments\n');
    process.exitCode = 1;
  }
}
