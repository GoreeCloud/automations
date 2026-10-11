# GoreeCloud Automations — Development storage and recovery contract

Status: **Development-only**; no production or device qualification claimed.

## Durable state and trust boundaries

The Node `EncryptedFileStore` is a reference adapter, not a cross-platform persistence API or key vault. Hosts supply a randomly generated **32-byte key** from a protected mechanism. The store never writes keys to disk. It stores one versioned AES-256-GCM-authenticated encrypted snapshot, uses an exclusive single-writer lock, restricts directory/file permissions, and replaces snapshots through temp-file fsync, atomic rename and directory fsync. Filesystem and hardware guarantees differ across runtimes; actual power-loss durability has not been tested.

A second worker opening the directory fails closed. A process crash may leave `.writer.lock`; investigate the process and surviving job state before manually reconciling/removing it. Do not implement automatic stale-lock cleanup or run concurrent workers against this snapshot store. A production runtime requires a transactional DB with a trustworthy lease model, key lifecycle, safe backups, and recovery/restore testing.

Corruption, authentication failure and wrong encryption key cause `StoreIntegrityError` instead of silently recreating state. An initialization marker (`.initialized`) also prevents treating a **missing jobs.enc journal** as a fresh empty store, even across restart. Existing valid legacy journals are non-destructively marked at next open. This marker is a local accidental-loss safeguard, **not** a rollback-resistant or deletion-proof security boundary; deleting both files remains undetectable without external protected metadata and independent backups. An intact backup and approved restore procedure are required; test backups must not overwrite an authoritative store. Rotate keys through an approved migration and retention process, not by replacing keys on an existing database.

## Execution and at-least-once behavior

Before calling a host action, the engine records `inflightStepId` and a stable idempotency key (`jobId:stepId`). On success it advances the cursor and clears the marker. If interrupted between external completion and state commit, the actual outcome may be unknown.

Recovery rechecks authorization, workflow availability and the persisted workflow snapshot. A non-replay-safe in-flight action enters `blocked / ACTION_OUTCOME_UNKNOWN`: a human or authoritative provider must reconcile effects before it is retried or overridden by a future explicit process. `replaySafe: true` must be reserved for actions with target-side durable idempotency, not merely handlers expected to "usually" have no duplicates. Successful recovery must be verified from the target system, not inferred from a retry attempt.

A newly edited workflow does not rewrite a paused job: it continues its pinned original definition. Removing/turning off a registered workflow blocks resumption; it does not bypass current identity, privacy, security or policy checks. Event IDs must remain stable across restarts. `pending()` surfaces network-blocked jobs; `resumePending()` tries each pending job after connectivity is restored; `cancel(jobId)` cancels queued network and retry jobs. `interrupted()` surfaces incomplete running jobs for explicit `recover(jobId)`. `dueRetries(at)` and `resumeDue(at)` expose due persisted retry work only after a trusted host wakeup; retries require an adapter with verified target-side idempotency. Cancellation never undoes effects that already ran.

## Known limitations and next gates

- Node single-process reference snapshot store, O(n) rewrite per transition; not suitable for large-scale queues.
- No host keyring integration, encrypted DB, distributed leases, reconciliation API, mobile/TV integration or server scheduler.
- No true process-kill/OS power-loss fault injection, device battery/background acceptance, or tested backup/restore/rotation lifecycle.
- No production Privacy Shield/Wardveil/Identity/Policy adapters wired into sample authorization.
- Filesystem/OS ACLs, root privileges and physical adversaries are outside this minimal reference implementation.

Release or Stable status requires real device/runtime tests and the GoreeCloud governance gates.
