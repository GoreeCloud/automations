# Starter Inspector CLI — development

The dependency-free `bin/starter-cli.mjs` command inspects the three bundled,
disabled starter definitions with **no login, action execution, permission grant,
network requests, or persistent workflow draft writes**.

Commands:

```sh
node bin/starter-cli.mjs list
node bin/starter-cli.mjs show quick-capture
node bin/starter-cli.mjs preview optional-delivery
node bin/starter-cli.mjs preview optional-delivery --online --approved
```

- `list`: machine-readable IDs, labels, descriptions, trigger types and step counts.
- `show ID`: a validated, disabled workflow JSON definition.
- `preview ID`: temporarily simulates enabled status for preflight decisions,
  **without modifying the disabled source or ever running an action**.
- `--online`: simulated network availability only.
- `--approved`: an example JSON event payload with `approved: true`, **not
  a grant of authorization**.

A preview prints `simulationOnly: true`,
`sourceWorkflowEnabled: false`, `authorizationGranted: false`, and
`sideEffectsExecuted: false`. A capability marked
`authorization_required` is not proof that an authorization has been issued.
Invalid commands and missing templates fail with generic messages that do not
echo untrusted user-provided values.

The CLI reads only the source-controlled example metadata and templates from
its own fixed paths. It does not contact providers. The starter picker in the
web editor is a separate, currently unpublished development candidate. Actual
workflow execution, native wakeups, protected keys, and Glaze consumer
acceptance remain independent release gates.

Run all Node regression tests with `npm test`.
