# Size-tiered parallelism budget over per-model fixed concurrency

Page-translation parallelism was effectively flat: the fallback concurrency
is 2, all three quality presets keep concurrency 2 (accurate drops to 1), and
the user override caps at 8 regardless of model. `AdaptiveBatchTuner` adapted
only per-batch tokens, assuming a single model's behavior distribution.
Real-world logs show the cost of that flatness: validation failures and
retries inflate the batch tail (66 planned vs 72 executed batches), and the
right setting differs by model size — small models fail more per item (a
large batch means a large bisect cascade) but tolerate high concurrency;
large models fail less but hit tight TPM ceilings and per-request latency.

We decided to control parallelism with a single in-flight token budget
`B = concurrency × per-batch tokens` (batch tokens counted as source tokens
plus expected output tokens, using the existing `OutputRatioTracker`
estimate), driven by two orthogonal control loops:

- **Budget loop (how much in flight):** HTTP 429 shrinks `B` (halving,
  honoring `Retry-After`); a latency regression (current P50 above 1.5× the
  session baseline P50) shrinks `B` by 0.8; a clean observation window grows
  `B`. These signals say nothing about how the budget should be split.
- **Allocation loop (how the budget is split):** the validation-failure
  rate slides the ratio `r` between concurrency and per-batch tokens while
  holding `B` constant — a high failure rate shrinks batches and back-fills
  concurrency (smaller blast radius), a low failure rate grows batches and
  releases concurrency (amortized prompt overhead).

Static size tiers supply the initial allocation and the boundaries the
loops may move within. Small and medium start at 2400 source-equivalent
tokens; large starts at 3200 to amortize its higher per-request latency.
Batch sizes and ceilings in the table are source-token equivalents; the
controller scales them by the observed output ratio when enforcing the
total estimated-token budget:

| Tier | Start (conc. × batch tok) | Concurrency bounds | Batch tok bounds | B ceiling |
|---|---|---|---|---|
| Small (tiny/flash/mini) | 4 × 600 | 2–12 | 256–1200 | 9 600 |
| Medium (default/unknown) | 2 × 1200 | 1–8 | 512–1600 | 4 800 |
| Large (pro/ultra/reasoning) | 2 × 1600 | 1–3 | 800–2400 | 3 200 |

Tier classification is registry-first (`registeredModelPatches`), with a
metadata fallback chain — price per token, then model-name pattern, then
context window — and unknown models land on the medium tier.

The new `BudgetController` takes over both concurrency and per-batch
sizing. `AdaptiveBatchTuner` is removed; the existing `OutputRatioTracker`
continues to provide the output-token estimate used by `B`. A
user-configured `maxConcurrentRequests` is a hard ceiling the loops never
exceed, and `ConcurrentRequestsLimit` rises from 8 to 12 to match the small
tier. The converged `(B, r)` is persisted per discovery identity
(provider + effective API URL + API key) and the next session cold-starts
at 0.8× to avoid overshoot after network or quota changes.

AIMD constants (growth step, shrink factors, failure-rate thresholds,
window sizes) are deliberately not fixed here: they come from a benchmark
sweep over `(B, r)` using a Node harness with a stub translator whose
latency/failure/conflict distributions are fitted by replaying exported
page-translation logs, validated against two or three real API points. The
page-translation log schema gains per-batch records (dispatch concurrency,
batch tokens, latency, retry/validation flags, terminology-conflict
attribution, `(B, r)` snapshot) so the loop's real-world convergence can be
audited. Terminology-conflict rate is recorded but intentionally excluded
from the feedback loop; glossary arbitration is a separate decision.

Scope: page translation only. Text/selection translation has no batches or
terminology memory and is unaffected.

## Considered Options

- **Per-model fixed table, no runtime adaptation:** rejected — provider
  rate limits vary by account tier and time of day; no static table can sit
  at the balance point, and a conservative table permanently wastes small
  models' headroom.
- **Fully adaptive from a cold start, no static tiers:** rejected — the
  first batches of every session would run at a blind guess; tiers give a
  defensible starting ratio and hard bounds for the loops.
- **Independent knobs for concurrency and batch size:** rejected — the two
  adapt against each other through the shared rate-limit wall and oscillate;
  the single budget makes the trade-off explicit: more concurrency is paid
  for with smaller batches.
- **Failure rate also shrinks `B`:** rejected — a failing small model would
  lose its throughput advantage; failure rate only changes the split, never
  the spend.
- **Terminology-conflict rate as a concurrency signal:** rejected for this
  loop — it trades speed against a quality dimension that belongs to
  glossary arbitration, which this ADR deliberately leaves open.
