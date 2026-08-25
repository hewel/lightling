# Query-string route changes are not navigations

Switching tabs on docs sites rewrites only the URL query (`?tab=examples`),
but the pipeline treated every `location.href` change as a full navigation:
session reset, `pageMemory.clear()`, processed-slots wipe, and a full-page
re-collection — roughly 470 queue entries per tab switch on one observed
site. We decided only origin or pathname changes count as navigation.
Query- and hash-only changes keep the session, caches, and processed slots;
the page's content changes arrive as ordinary mutations and are collected
incrementally. The navigation reset itself was also made atomic: it
completes synchronously and the backend abort is fire-and-forget, so a slow
MV3 service worker can no longer open a window in which in-flight
responses get mass-marked stale on the not-yet-spliced log.

## Considered Options

- Reset on any href change (status quo): the source of the queue storm.
- Never reset and rely on mutations alone: loses the session abort and
  state cleanup that a real pathname navigation still needs.
- Keep awaiting the backend abort before resetting: under MV3 cold start
  the await can hang for seconds, leaving a half-reset pipeline that
  rejected every in-flight response (431 stale targets in one second were
  observed in a field log).

## Consequences

`PagePipelineMetrics` splits `navigationCancellations`
(generation-mismatch discards, mostly navigation) from
`staleCancellations` (per-unit liveness failures), so field logs can tell
the two apart.
