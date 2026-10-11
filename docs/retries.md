# GoreeCloud Automations — Bounded retry contract (development)

**Development-only.** No OS scheduler, native adapter, target-side idempotency or production delivery semantics are implied.

A workflow step can declare:

```json
{"id":"send","action":"remote.send","retry":{"maxAttempts":3,"backoffMs":1000}}
```

The parser requires `maxAttempts` as an integer **2–6**, including the first attempt, and `backoffMs` as an integer **1,000–3,600,000**. The retry delay is `min(backoffMs × 2^(attempt - 1), 24 hours)`. All attempts use the **same** `jobId:stepId` idempotency key. The action MUST explicitly register `replaySafe: true` and **enforce durable target-side idempotency**. Otherwise a retry-configured step blocks *before initial execution* as `RETRY_NOT_SAFE`.

When a replay-safe action throws, its sanitized `waiting_retry` job checkpoint records `attempt`, `retryAt` (UTC), and `RETRY_SCHEDULED`. Adapter errors and secrets are not persisted. A trusted host uses `dueRetries(at)` and `resumeDue(at)` or `resumeRetry(id,at)` on OS-permitted wakes. The engine provides no actual system wakeup. Each retry checks authorization again, uses the original workflow snapshot, and blocks if the adapter has lost replay safety. Exhausted retries end in `failed / ACTION_FAILED`. A host may cancel work still waiting for network or retry, never undo already-executed effects.

Every action attempt is durably checkpointed before invoking its host adapter. If a process dies with an uncertain result, `recover(jobId)` can replay that action only if its current adapter remains replay safe; otherwise it blocks with `ACTION_OUTCOME_UNKNOWN`. A local encrypted journal does **not** provide exactly-once external effects. Never opt into `replaySafe` merely to enable convenient retries for emails, payments, deletions, or other potentially irreversible actions without a provider-side deduplication contract.

Production acceptance still requires native wakeup, provider-side idempotency, key lifecycle, transaction and crash fault-injection testing, and accessible Glaze state explanations.