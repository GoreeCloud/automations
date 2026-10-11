# GoreeCloud Automations — Interval scheduling contract (development)

## Capability

A version 1 workflow accepts an event trigger or a UTC interval trigger:

```json
{"type":"interval", "everyMs":60000, "anchorAt":"2026-10-11T00:00:00.000Z"}
```

`everyMs` is an integer from 60,000 to 2,678,400,000 milliseconds (31 days). `anchorAt` must be a canonical ISO-8601 UTC timestamp with three fractional digits. One workflow can have multiple event/interval triggers (up to 16). Date-local schedules, calendar recurrences, daylight saving, solar triggers, cron, and sub-minute schedules are intentionally not implemented in this slice.

The host invokes `await engine.tick(new Date().toISOString())` when an OS-permitted wake event occurs. The engine selects **only the latest due slot** for each registered, enabled interval trigger. It generates a deterministic event ID `interval-<index>-<dueMillis>`, sets `payload.scheduledAt`, and processes steps through the same authorization, offline deferral and encrypted persistence interfaces as named event triggers. A duplicate tick in the same slot is deduplicated when the host supplies a conformant store. Missed earlier slots are intentionally not backfilled; this favors safety, bounded processing and battery over attempting uncontrolled catch-up after days offline.

`tick()` does **not** schedule OS wake-ups by itself; it never promises guaranteed real-time alarms or permanently running phone/TV services. Platform hosts must account for Android background execution, iOS scheduling constraints, desktop sleep, TV background limitations, timezone presentation, process restart and battery permissions. Device-specific adapters must clearly disclose their limitations and obtain consent for required capabilities. In multi-device deployments, deterministic IDs alone are not global deduplication; coordination belongs to trusted native runtimes/Mesh/Sync and authoritative target-side idempotency.

## Deferred network operations

`pending()` lists `waiting_network` jobs. A host can call `resumePending()` after an authenticated network-status change, and can cancel an individual queued job with `cancel(jobId)`. Cancellation applies **only to jobs waiting for network**. It does not roll back local actions that already finished or interrupt side-effecting actions currently executing. Resumption always rechecks registered workflow availability, current authorization, and current network state. Jobs that were cancelled remain terminal and are not resumed.

## Illustrative host invocation

```js
const engine = new WorkflowEngine({
  store, // trusted journal implementation
  now: () => new Date().toISOString(),
  online: isNetworkAvailable,
  authorize: realPolicyAdapter, // never hardcode allow-all in production
});
engine.registerAction('local.note', trustedNoteAdapter);
engine.registerWorkflow(intervalDefinition);
const jobs = await engine.tick(); // call only after authorized OS/host wakeup
// When an authenticated connectivity signal arrives:
const resumed = await engine.resumePending();
```

This implementation remains a development prototype; native wakeups, real target-side idempotency, key management and OS-level testing are not yet present.
