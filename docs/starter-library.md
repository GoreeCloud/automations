# Starter workflows — development contract

Three reviewed, disabled version-one starter definitions ship as `examples/starter-templates.json`:
quick capture, hourly reminder, and optional delivery.

The portable `loadStarters` and `selectStarter` helpers in `web/editor-state.mjs`
validate metadata, reject duplicate identifiers and enabled starter input,
and return independent deep copies. They never call action implementations,
grant permissions or schedule runtime execution.

**Present status:** This is an exported library for developer integration.
The existing Workflow Studio HTML has no starter picker in the published branch.
UI wiring, accessible interaction checks and offline-shell publication remain
outstanding. The editor remains local-only and will not load these templates
until the UI and static HTTP allowlist are reviewed and published together.

The hourly starter requires an authorized host scheduler. `remote.send` has
no provider connection and remains unavailable until a host registers it.
Authoritative Identity, Policy, Wardveil and Privacy Shield checks are still
required for every eventual action.

Local test: `npm test`. No runtime permissions, provider credentials or
external HTTP connections are installed by this starter library.
