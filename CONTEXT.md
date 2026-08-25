# Context

Ubiquitous language for page translation. Glossary only — implementation
decisions live in `docs/adr/`, not here.

## Terms

- **Translation field** — one translatable slot: a text node or an approved
  text-bearing attribute (`title`, `placeholder`, `aria-label`, `alt`).
  Code counterpart: `TextOccurrence`.
- **Translation unit** — one semantic group of fields translated together
  under a single semantic key; may span inline elements. Code counterpart:
  `TranslationUnit`.
- **Source state** — page-owned original content held outside the DOM
  (original text, original children, original attribute values). Code
  counterpart: `SegmentBinding`. Rule: never infer the original from
  already-translated DOM.
- **Semantic key** — the canonical hash identifying a unit for caching,
  dedup, and staleness validation: normalized source text, language pair,
  field kind/slot, context class, provider/model, and
  glossary/prompt/profile/normalization versions.
- **Pipeline generation** — pipeline-wide monotonic counter, bumped on
  start/stop and SPA URL change; the coarse staleness gate for async
  responses and queued commits.
- **Source revision** — per-unit freshness of a unit's source. Validated by
  semantic-key fingerprint (a live unit with the request's semantic key
  must exist), not by a monotonic counter: if source text leaves and
  returns (A→B→A), the earlier response is valid again and must be
  accepted.
- **Stale response** — a translation response whose semantic key no longer
  matches any live unit at validation time. It is stored in the cache under
  its own key (it remains a correct translation of its own source text) but
  is never committed to the DOM, and is counted in `staleCancellations`.
- **Expected write** — a translator-owned DOM transition, registered so
  observer records can be attributed. Current mechanism: pre-write node
  provenance (`PageTranslationProvenance` WeakSet) plus post-write applied
  snapshots (`appliedText` / `appliedAttributes` / `appliedChildren`).
- **Commit** — a validated translation write applied only through the DOM
  commit funnel (`PageTranslationDomLifecycle.applyUnit` via the apply
  queue). Translation logic never writes the DOM directly.
- **Dirty boundary / rescan root** — the smallest element region
  re-collected after confirmed external mutations.
- **Quiet window** — the fixed stabilization delay applied per dirty
  boundary before scheduling translation of dynamic rescans; new mutations
  in the same boundary reset it. Initial scans and content restores are
  exempt.
- **Framework re-render** — a page-owned write that restores a value equal
  to the stored source; repaired by reapplying the stored translation
  without a new model request.
- **Visibility lane** — the first sort key of a unit's scheduling
  urgency: Urgent, Visible, Near, or Rest. Derived from viewport
  intersection state and urgent semantic signals (open dialogs, alerts,
  assertive live regions); changes as the viewport moves. A
  deduplicated unit takes the highest lane among its occurrences.
  Code counterpart: `TranslationPriorityLane`.
- **Reorder buffer** — the set of collected-but-undispatched units
  whose dispatch order follows current visibility lanes. Only
  undispatched work can be re-ranked; dispatched batches are final.
  Code counterpart: pre-admission buffer in `PageTranslationPipeline`.
