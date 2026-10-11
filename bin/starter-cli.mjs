#!/usr/bin/env node
/** Inspect inert workflow starters. This CLI never registers or executes actions. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadStarters, selectStarter } from '../web/editor-state.mjs';
import { previewWorkflow } from '../src/engine.mjs';

const loadJSON = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));

export async function runStarterCLI(args = [], io = {}) {
  const write = io.write ?? (value => process.stdout.write(value));
  const fail = io.fail ?? (value => process.stderr.write(value));
  const [command = 'list', id, ...flags] = args;
  if (!['list', 'show', 'preview'].includes(command) || flags.some(f => !['--online', '--approved'].includes(f)) ||
      (command === 'list' && (id || flags.length)) || (command === 'show' && (!id || flags.length)) ||
      (command === 'preview' && !id)) {
    fail('Usage: starter-cli.mjs list | show ID | preview ID [--online] [--approved]\n');
    return 2;
  }
  try {
    const catalog = await loadJSON('../examples/action-catalog.json');
    const entries = loadStarters(await loadJSON('../examples/starter-templates.json'), catalog);
    if (command === 'list') {
      write(JSON.stringify(entries.map(({ id, label, description, workflow }) =>
        ({ id, label, description, triggerType: workflow.triggers[0].type, steps: workflow.steps.length })), null, 2) + '\n');
      return 0;
    }
    const workflow = selectStarter(entries, id, catalog);
    if (command === 'show') {
      write(JSON.stringify(workflow, null, 2) + '\n');
      return 0;
    }
    // Simulating an enabled state is ONLY for preflight; the exported source
    // remains disabled. No authorization callback or external host is involved.
    const report = previewWorkflow({ ...workflow, enabled: true }, {
      actions: catalog,
      payload: flags.includes('--approved') ? { approved: true } : {},
      online: flags.includes('--online'),
    });
    write(JSON.stringify({ ...report, simulationOnly: true, sourceWorkflowEnabled: false }, null, 2) + '\n');
    return 0;
  } catch {
    fail('Starter inspection failed. Verify the identifier and local template integrity.\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runStarterCLI(process.argv.slice(2));
}
