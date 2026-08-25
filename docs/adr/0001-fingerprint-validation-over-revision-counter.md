# Fingerprint validation over per-unit revision counters

We evaluated a dynamic-translation architecture proposal that prescribes a
per-unit monotonic source revision carried on every translation request,
with stale responses discarded entirely (never applied, never cached).
We decided to validate per-unit staleness by semantic-key fingerprint
instead: a response is committed only if a live translation unit with its
semantic key still exists, checked at response arrival and again before
commit. The semantic key already hashes the normalized source text, so a
page-owned source change yields a new key and old responses mismatch
automatically. Unlike a counter, fingerprint validation accepts a response
when source text leaves and returns (A→B→A), which is both correct and
cheaper under a billed remote API. Stale responses are still written to
the cache under their own key — they remain correct translations of their
own source text; only DOM commit is blocked.

## Considered Options

- Per-unit monotonic revision counter (proposal's literal design): rejects
  reusable responses under A→B→A thrash and adds ordering state we do not
  need, since equality of the fingerprint is the actual contract.
- Pipeline-generation-only checks (status quo): cannot invalidate work
  when source changes without an SPA navigation; left the re-queue hole
  where a response arriving after its occurrence was removed could be
  re-queued and committed over newer page content.
