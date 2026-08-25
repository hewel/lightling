# Provenance attribution over an expected-write ledger

The same architecture proposal prescribes a pre-write expected-write
ledger: every translator-owned DOM transition registered before commit and
consumed when the MutationObserver later reports it. We decided to keep
the existing attribution mechanism: pre-write node provenance
(`PageTranslationProvenance` WeakSet) plus post-write applied snapshots
(`appliedText` / `appliedAttributes` / `appliedChildren`) matched in
`collectRescanRoots`.

## Considered Options

- Expected-write ledger (proposal's design): we walked its adversarial
  scenario — translator writes B, page overwrites C before the observer
  callback — and the current mechanism already lands on the correct
  branch: the final value C differs from the applied snapshot, so the
  conflict path restores and adopts C as new source. The ledger's
  incremental value is unproven, and swapping attribution rewrites a
  working layer that runs inside mutation callbacks under a tight
  performance budget.
- Timing flags or observer disconnects: rejected by both the proposal and
  the current code; recorded here so they are not re-suggested.
