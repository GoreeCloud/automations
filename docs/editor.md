# Workflow Studio — web development editor (Glaze-aligned candidate)

**Status:** Development-only consumer prototype. GoreeCloud/glaze `1.7.0` is the required Stable/Anchor shared design target, but this application **has not** completed repository-local Glaze 1.7.0 consumer acceptance. This editor implements a dependency-free, Glaze-aligned presentation layer; it does **not** vendor or execute the canonical Glaze runtime. The canonical Glaze release remains the source of truth for its own behavior. Do not advertise consumer certification.

## Working user journey

1. Run `npm run editor`, then open `http://127.0.0.1:4173/` on that computer. The development server listens on **loopback only**, not on the network.
2. Start with a **disabled** workflow; edit its name and stable ID, choose an event or UTC interval trigger, and arrange one or more steps. Use the action selector, JSON inputs, optional payload-based conditions, and bounded retry policy. Undo/redo (32 snapshot limit) is available for editing and step reordering; keyboard shortcuts work outside native input controls. Undo history stays in memory and is cleared on new/import. Changes are in memory only: the editor has no autonomous execution or background job service.
3. Toggle **Simulate network available** and enter an **example JSON payload**. Press **Preview workflow** to obtain a read-only report from the **same** `previewWorkflow` engine used by the CLI. The report shows disabled/skipped/unavailable/unsafe retry/waiting network/authorization required states. Preview executes **zero** host actions and grants **zero** capabilities.
4. Export a valid JSON definition through the browser download. The browser never sends it to an external service. Explicitly import it later into a trusted host only after that host performs its own authorization, privacy/security, lifecycle, and idempotency checks. The definition's `enabled` flag is **not** proof of runtime activation.
5. Import a `.json` file through an explicit file picker; files above 256 KiB and definitions failing `previewWorkflow` validation are rejected. No file is automatically discovered, uploaded, or run. Existing state is preserved on import failure.

The included metadata catalog has only illustrative `local.note` and `remote.send` entries. It is **not** a connector registry, authority grant, or credential source. No sign-in, password collection, third-party API call, cloud session, or privileged device action is available in the editor.

## Implementation and safety

- `web/index.html`: semantic page, visible development status, keyboard-accessible buttons, labeled inputs, screen-reader status, skip link, and undo/redo controls.
- `web/editor.css`: adaptive desktop/mobile layout; light/dark colors; visible focus; reduced-motion respect; no external fonts or styles.
- `web/editor-state.mjs`: testable pure editor transformations, safe JSON import/export limits and reuse of the canonical engine preflight.
- `web/editor.mjs`: browser controller, 32-level in-memory undo/redo, keyboard focus recovery after structural edits, DOM-based safe text output rather than concatenated untrusted HTML; requires explicit user actions for import, export and preview.
- `bin/serve-editor.mjs`: local-only HTTP static allowlist, CSP, MIME nosniff, no server storage, no APIs, no remote listeners or third-party code.

**Security constraints:** This is an *authoring interface*, not an executor. Real runtime actions still need GoreeCloud Identity, Privacy Shield, Wardveil, Policy and device-local least-privilege enforcement. Preview must never be treated as permission. For retry safety, a checkbox is not evidence of durable target-side idempotency: the execution adapter retains that duty. Credentials should never be entered in workflow input JSON; production secret references and secure storage are future features.

**Availability:** A loopback server can run without internet connectivity. It does not work while the host process is stopped and does not automatically become an offline-installable PWA, mobile application, or TV application. The Node runtime and development server must be started explicitly. Browser download locations are controlled by the browser and operating system.

## Development verification

`npm test` covers core execution, safe preview, retry/cancellation, encrypted-store recovery, and editor state/server route checks. A Chromium developer smoke test exercised browser initialization, preview, step addition, trigger switching and responsive layout by injecting **exact local JS/CSS** into an isolated page because this environment blocks direct browser navigation to localhost. The smoke test is not real device or external served-page acceptance. Physical-device keyboard, screen-reader, TV remote, cross-browser, dark-theme and native key management remain **unverified**.

## Next acceptance gates

- Consume the canonical Glaze 1.7.0 runtime through an approved exact-version integration and verify presentation-only semantics; complete repository-local Glaze consumer acceptance and update the governed registry only with actual evidence.
- Test a fresh served web session and runtime navigation on representative browsers/devices; verify keyboard, alternative input, screen readers, high contrast, reduced motion, light/dark, localization and small/large form factors.
- Add a host-backed encrypted draft store and explicit export/import provenance before handling sensitive data. Never store raw secrets in workflow JSON.
- Integrate host actions only after platform authorization gates, real device scheduling, native key custody, transaction handling, and recovery proof are satisfied.
