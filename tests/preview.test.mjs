import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WorkflowEngine, previewWorkflow } from '../src/engine.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = { id:'preview', version:1, name:'Preview', enabled:true,
  triggers:[{type:'event',name:'event.sent'}],
  steps:[
    {id:'conditional', action:'local.note', when:{op:'eq',path:'payload.approved', value:true}, input:{secret:'never emit'}},
    {id:'send', action:'remote.send', retry:{maxAttempts:2,backoffMs:1000}},
    {id:'unknown', action:'unavailable.action'}
  ] };
const actions = {
  'local.note': {capability:'notes.write',requiresNetwork:false,replaySafe:false},
  'remote.send': {capability:'mail.send',requiresNetwork:true,replaySafe:true}
};

test('preflight distinguishes skips, offline dependencies, and missing adapters without input disclosure', () => {
  const report = previewWorkflow(workflow, {actions, online:false, payload:{approved:false, token:'secret'}});
  assert.deepEqual(report.steps.map(s=>s.decision), ['skipped','waiting_network','unavailable']);
  assert.equal(report.sideEffectsExecuted, false);
  assert.equal(report.authorizationGranted, false);
  assert.equal(JSON.stringify(report).includes('secret'),false);
  assert.equal(report.steps[1].capability,'mail.send');
});

test('online preview never grants capabilities and detects unsafe retry', () => {
  const invalidReplay = {'remote.send': {...actions['remote.send'], replaySafe:false},'local.note':actions['local.note']};
  const report = previewWorkflow(workflow, {actions:invalidReplay, online:true, payload:{approved:true}});
  assert.deepEqual(report.steps.map(s=>s.decision), ['authorization_required','unsafe_retry','unavailable']);
  assert.equal(report.steps[0].authorizationRequired,true);
});

test('engine preview does not invoke action, authorize or store methods', () => {
  let executions=0, permissionChecks=0;
  const engine = new WorkflowEngine({online:()=>false,authorize:async()=>{permissionChecks++;return true;}});
  engine.registerWorkflow(workflow);
  engine.registerAction('local.note',{capability:'notes.write',execute:async()=>executions++});
  engine.registerAction('remote.send',{capability:'mail.send',requiresNetwork:true,replaySafe:true,execute:async()=>executions++});
  assert.equal(engine.preview('preview',{payload:{approved:true}}).steps[1].decision,'waiting_network');
  assert.equal(executions,0);
  assert.equal(permissionChecks,0);
});

test('malformed workflow and catalog fail closed', () => {
  assert.throws(()=>previewWorkflow({...workflow,steps:[]},{actions}));
  assert.throws(()=>previewWorkflow(workflow,{actions:{'remote.send':{capability:'mail.send',requiresNetwork:'yes',replaySafe:true}},payload:{approved:true}}));
  assert.throws(()=>previewWorkflow(workflow,{actions,payload:null}));
  assert.throws(()=>previewWorkflow(workflow,{actions,online:'yes'}));
});

test('disabled workflow never previews a runnable step', () => {
  const report=previewWorkflow({...workflow,enabled:false},{actions,online:true,payload:{approved:true}});
  assert.ok(report.steps.every(step=>step.decision==='disabled'));
});

test('CLI previews real example offline without executing any action', () => {
  const run=spawnSync(process.execPath,['bin/preview.mjs','examples/offline-morning.json','--catalog','examples/action-catalog.json','--payload','examples/preview-payload.json'], {cwd:project,encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.ok(report.steps.some(s=>s.decision==='waiting_network'));
  assert.equal(report.sideEffectsExecuted,false);
});

test('CLI reports invalid paths without exposing the user-provided path', () => {
  const secretName='secret-credential-path.json';
  const run=spawnSync(process.execPath,['bin/preview.mjs',secretName,'--catalog','examples/action-catalog.json'],{cwd:project,encoding:'utf8',timeout:10000});
  assert.equal(run.status,1);
  assert.ok(!run.stderr.includes(secretName));
});

test('named event does not dispatch an interval trigger with an incidental name field', async () => {
  let calls=0;
  const engine=new WorkflowEngine({authorize:async()=>true});
  engine.registerAction('local.note',{capability:'notes.write',execute:async()=>calls++});
  engine.registerWorkflow({...workflow,id:'timer',triggers:[{type:'interval',name:'event.sent',everyMs:60000,anchorAt:'2026-10-11T00:00:00.000Z'}],steps:[{id:'save',action:'local.note'}]});
  assert.deepEqual(await engine.emit('event.sent','evt1'),[]);
  assert.equal(calls,0);
});
