# GoreeCloud Automations — milestone-based delivery plan

**All milestones below are planned unless marked as a verified development slice. No dates or production claims are implied.**

| Phase | Priority | Outcome / verifiable acceptance |
|---|---|---|
| 0. Governance + scope | P0 | Reconcile ten-system proposal with authoritative Instructions/Decision/architecture through controlled revision, platform boundary review, threat model, retained task register, and repository index confirmation. Repo is already `GoreeCloud/automations`, not a new repo. |
| 1. Reliable local MVP | P0 | Durable encrypted on-device event/run journal; local event/manual/interval triggers; safe local actions and conditionals; cancellation, bounded replay-safe retries, workflow enable/disable, reauthorization, failure explanation, idempotency, power-loss recovery, unit and integration tests. **In progress:** portable engine, encrypted single-node Node snapshot store, crash-aware step checkpoints and recovery tests; native and production-grade storage remain pending. |
| 2. Builder + integration | P0/P1 | Glaze quick editor + linear/graph builder, device capability picker, simulation/test mode; capability registry, first-party Notes/Tasks/Mail/Memos/Notify/Mesh adapters; onboarding; screen-reader and TV input acceptance. |
| 3. Cross-device + offline sync | P1 | Device identity, secure pairing, opt-in execution placement, workflow definition syncing through GoreeCloud Sync, signed event envelopes, conflict resolution and duplicate-suppression across devices. |
| 4. Server orchestrator | P1 | Self-hosted worker pool, durable schedules/queues, webhook ingress with anti-replay, retry/dead-letter handling, queue metrics, approval gates and rollback/recovery drills. |
| 5. Platform clients | P1/P2 | Android, desktop, iOS/iPadOS, browser/PWA, and TV runtime integrations in OS-permitted scopes; device matrix acceptance. |
| 6. Advanced workflows | P2 | DAG fanout, loops, typed variables, nested flows, reusable modules, distributed transaction compensation, AI-assisted draft authoring, safe script sandbox, connector SDK, template gallery, signed distribution. |
| 7. Migration & qualification | P2 | Supported importers for Shortcuts/IFTTT/n8n/Zapier representations where export/API rights and semantics permit, with unsupported-step reports; production security, accessibility, recovery, performance and upgrade certification. |

## Current development slice acceptance

- [x] Versioned named-event/UTC interval-triggered workflow parser and validation (host-driven latest-only ticks, not OS-native scheduled wakeups).
- [x] Registered action adapter execution, deny-by-default authorization.
- [x] Offline local step + deferred network action with resume, bulk resume and queued-job cancellation.
- [x] Stable run keys with within-worker duplicate prevention and atomic-store contract.
- [x] Explicit success/failed/blocked/waiting status, sanitized transition hook and isolated telemetry failures.
- [x] Bounded exponential backoff for host-registered replay-safe actions, persisted retry deadline and host-driven due queue; native wakeup and process-kill testing remain pending.
- [x] Local test suite (28 passing as of October 11 development cycle).
- [ ] Authoritative GitHub CI validation on the exact candidate branch.
- [x] Development-only encrypted Node snapshot storage with restart, integrity and missing-journal tests; interrupted unsafe side effects fail closed.
- [ ] Production-grade transactional storage, OS-protected keys, recovery drills, power-loss tests and native device qualification.
- [ ] Native mobile, desktop, browser, TV execution and UX acceptance.
- [ ] Core platform contracts, real adapters and production permissions.
- [ ] Governance adoption of the tenth system and dependent index amendments.

## Suggested engineering workstreams

**Core + storage:** encrypted queue, durable store (SQLite/WAL on compatible runtimes), restart recovery, stable event origin keys, delivery semantics, retry policies.

**Platform integrations:** typed action manifests for Tasks/Notes/Notify/AI/Search/Mail, Mesh capability discovery, Identity/Privacy Shield/Wardveil/Policy enforcement, Sync definitions, Everkeep backup/restore, Observability/Manager read-only evidence.

**Experience + clients:** Glaze builder, scheduling, voice/OS intents, share-sheet actions, D-pad TV controls, permission explainers, offline/degraded status.

**Quality:** synthetic fixtures, fuzzed schema input, denial and revocation tests, simultaneous event tests, process crash recovery, storage corruption tests, upgrade migrations, property-based action ordering, accessibility and device support matrix.

## Risk register

| Risk | Required mitigation |
|---|---|
| OS background constraints make 'always-on offline' impossible on some devices | Explicit capability matrix and optional authorized home hub/server executor; honest user-visible delivery expectations |
| Privilege escalation via connectors or AI-authored workflows | Default deny, capability manifests, least privilege, policy rechecks and approvals; AI cannot activate itself |
| Duplicate or lost actions at restart or cross-device handoff | Durable journal, atomic event claims, stable idempotency keys, at-least-once guarantees, target-side dedup, test recovery |
| Private data leak through workflow logs or sharing | Consent/purpose checks, schema-scoped data minimization, encryption, redaction, export sanitization |
| n8n/Zapier/Shortcuts import incompatibility | Versioned importer adapters, dry-run diff and unsupported-feature reports; no misleading 100% import promise |

### Authoring preview and process-interruption evidence (development cycle)

- Added portable read-only workflow preflight, metadata catalog and offline CLI for a practical authoring/inspection flow, without granting permissions or invoking actions.
- Added a separate-process SIGKILL regression that validates non-idempotent side-effect uncertainty is blocked after reopening encrypted state. Process termination does not substitute for device power-loss qualification.
- Next: Glaze workflow editor with an explicit review/activate flow, native host adapters, real secure key custody, transactional storage, and OS background-execution qualification.


## October 11 visual authoring development slice

- Implemented: responsive local-loopback-only Workflow Studio, accessible labels/keyboard controls, event/interval definition editing, condition/retry/step order editing, explicit JSON import/export, read-only preflight.
- Tested in development: editor state transformations, HTTP route allowlist, CSP and denial of server writes, plus Chromium isolated-page smoke testing of preview and step editing. **Not** Glaze consumer acceptance, physical-device acceptance, mobile installation or production readiness.
- Next: exact-version canonical Glaze 1.7.0 runtime adoption, broader keyboard/assistive-tech and representative device testing, secure draft storage, host event providers and native scheduling.
