# GoreeCloud Automations

**Status: Development foundation — not deployed, not Stable, and not yet adopted by the canonical nine-system platform governance.**

GoreeCloud Automations is the proposed **tenth Integral Platform System**: a first-party, offline-first, cross-device workflow authoring and execution plane intended to combine the approachable personal automations of iOS Shortcuts and IFTTT with the extensibility, routing, and orchestration capabilities of n8n and Zapier. It is **not a fork** of those products.

The proposed authority is *what work should run, where, when, with which approved capabilities, and how the work is resumed and explained*. It does **not** become the authority for identity, privacy, security, policy, connectivity, data synchronization, recovery, application data, or system telemetry.

## Implemented in this branch

- Small dependency-free ECMAScript workflow engine for host environments supporting modern JavaScript.
- Versioned declarative event-triggered workflows with ordered steps and safe conditional checks.
- Local/offline-capable host action registration; offline network steps enter an explicit `waiting_network` state.
- Resume from the paused step and prevent duplicate event execution in one worker, with atomic-store support for cross-worker event deduplication.
- Explicit authorization on **every step** and default-deny behavior; unavailable actions are blocked.
- Distinct succeeded, failed, blocked, skipped, waiting-network state; sanitized operational transition events.
- Memory-only test/example storage; portable storage interface for future encrypted durable device storage.
- Seven automated Node tests passing locally at authoring time; GitHub CI and actual device behavior require independent verification.

**This is not a usable native mobile/TV app, a workflow designer, a network scheduler, or a persisted offline background-service implementation yet.** Registration and action implementations are injected by host applications. No external HTTP service, AI provider, OS automation, privileged device control, or cloud account is enabled by this core.

## Quick start

With Node.js 20+:

```bash
npm test
```

A host registers a permitted action and explicitly wires the authorization adapter:

```js
import { WorkflowEngine } from './src/engine.mjs';
import workflow from './examples/offline-morning.json' with { type: 'json' };

const engine = new WorkflowEngine({
  online: () => false,
  authorize: async ({ capability }) => capability === 'notes.write',
});
engine.registerAction('local.note', {
  capability: 'notes.write',
  execute: async ({ input, idempotencyKey }) => {
    // Production adapter must durably deduplicate this idempotency key.
    console.log(input.title, idempotencyKey);
  }
});
engine.registerWorkflow(workflow);
const [job] = await engine.emit('alarm.dismissed', 'event-001', { share: false });
console.log(job.status); // blocked until remote.send is registered, or skipped when share=false
```

### Operational contract

Treat workflow and trigger JSON as untrusted input. Production adapters MUST enforce authoritative GoreeCloud Identity, Privacy Shield, Wardveil Security, and GoreeCloud Policy decisions, and MUST never use permissive placeholder authorization. Host actions must enforce scoped permissions at the actual resource boundary and deduplicate stable idempotency keys. Do not record secrets in workflow definitions. Event sources must generate stable IDs. Production storage must be encrypted, durable, atomic, and backed up according to Everkeep policy.

See [Architecture](docs/architecture.md) and [Product roadmap](docs/roadmap.md).