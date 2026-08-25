# Dynamic visibility lanes over static scan-time priority

On long pages, visible content arrives too late: unit priority was a
scan-time static snapshot (`getPriority` viewport rect: 4/3/1), scrolling
never re-ranked, and every unit entered a FIFO admission queue. We decided
to make priority dynamic: four visibility lanes (Urgent / Visible / Near /
Rest) tracked by per-occurrence `IntersectionObserver` (Near via ~100%
rootMargin), a minimal lexicographic ordering — lane, then viewport
distance with scroll-direction bias, then the existing numeric priority,
then document order — and a reorder buffer ahead of admission in the
content script. A deduplicated unit takes the highest lane among its
occurrences; occurrence counts never cross lane boundaries. Urgent lane
membership is a collection-time static selector check
(`dialog[open]`, `[role="dialog"][aria-modal="true"]`, `[role="alert"]`,
`[aria-live="assertive"]`); dynamically appearing dialogs arrive through
the existing mutation rescan path. Visible lanes dispatch in smaller
batches for latency, background lanes keep the existing token-aware
sizing. The backend `LLMScheduler`, dedup, translation memory, session
signature, and DOM lifecycle are unchanged.

## Considered Options

- **Seven-lane model (P0–P6) with page-type classifier, Readability, and
  heuristic main-content detection:** rejected — under
  visibility-dominant ordering, extra background lanes only reorder
  content the user cannot see; the detection rules and tuning surface buy
  no perceptible effect. The existing crude `buildPageProfile`
  classification stays as is.
- **Deferred collection (true lazy translate):** rejected — full
  collection preserves the translate-whole-page contract; fast scrolling
  would flash untranslated text. The `lazyTranslate` config flag remains
  a no-op in the session signature.
- **Re-ranking inside the backend `LLMScheduler`:** rejected — the
  scheduler is shared across tabs and features (popup/selection
  translation); re-ranking there is invasive, and only pre-admission work
  benefits from re-ranking anyway.
- **Preemption with reserved foreground capacity and in-flight
  cancellation:** rejected — aborting in-flight background requests burns
  already-spent input tokens and interacts badly with the budget
  controller (ADR 0004); no measured pain of background work starving
  foreground work.
- **Focus and selection as urgent signals:** rejected — selection
  translation overlaps the existing SelectTranslator feature, and writing
  translations into a control the user is actively editing risks IME and
  controlled-component disruption.

## Consequences

- Applied translations shift layout, which re-triggers intersection
  observations; observer entry handling is debounced, and committed units
  leave the reorderable set.
- Hidden content (`display:none`, `aria-hidden`) never intersects and
  stays in Rest; observer registration may skip it.
- Metrics gain per-lane unit counts and a re-rank count;
  `firstVisibleTranslationAt` remains the headline latency signal.
- The static viewport-rect computation in `getPriority` is superseded by
  observer-driven lane updates once implementation lands.
