# Read-only workflow preview contract (development)

## User outcome

Before enabling a workflow, users and the future Glaze builder can inspect which steps will be skipped, which require a network connection or capability authorization, which are unavailable, and which declare unsafe retries. **Preview never executes an action or grants a capability.** It is a point-in-time explanation, not a simulation of effects, authorization approval, a promise that the OS will wake a workflow, or a guarantee of future execution.

## Portable API

`previewWorkflow(workflow, { actions, payload, online })` validates a version-one definition and reports step metadata. `actions` is a host-provided metadata catalog keyed by action ID with `{capability, requiresNetwork, replaySafe}`. It contains **no callable execution function**. The report intentionally excludes payload, input values, actor identity, and secret-bearing exception text. Decision outcomes: `disabled`, `skipped`, `unavailable`, `unsafe_retry`, `waiting_network`, and `authorization_required`. Authorization is always unknown and must be re-evaluated during real execution. `WorkflowEngine.preview(id, {payload})` produces the same report using registered adapter metadata, without calling `authorize`, `execute`, or storage methods.

### Local CLI (offline, no execution)

Run from the repo root with Node 20+:

```sh
node bin/preview.mjs examples/offline-morning.json \
  --catalog examples/action-catalog.json \
  --payload examples/preview-payload.json
```

Add `--online` to see the connectivity-dependent forecast. The catalog is **local illustrative metadata**, not real adapters or permissions. The preview command reads only the files named on its command line, never writes persistent workflow state, and never connects to external services. Its output is valid JSON that a future Glaze interface can consume; UI integration and accessibility are not yet verified.

## Security & interoperability boundaries

- Never derive authorization from preview output; actual host adapters must enforce GoreeCloud Identity, Privacy Shield, Wardveil Security, and Policy at execution time and at the resource boundary.
- Never treat `replaySafe` as trustworthy without a durable target-side idempotency contract.
- Require a separate, explicit user action to save, activate, or run a workflow. No connector login, password capture, or privileged execution is supplied by this preview.
- Use design system terminology and accessible status text in the eventual Glaze-based visual editor; do not encode status by color alone.
- Actual iOS, Android, desktop, TV and browser host adapters remain pending.

## Acceptance evidence

Automated Node tests cover disabled workflows, conditions, missing adapters, retry hazards, offline/online forecasts, failed validation, absence of action/authorization invocations, CLI output and failure sanitization. These are development-runtime tests, **not** native-device, UI, or production checks.
