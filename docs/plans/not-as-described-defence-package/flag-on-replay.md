# Not-as-described — flag-ON replay (prod, read-only)

Run 2026-09-28T12:28:01.620Z against prod. Population: open PRODUCT_UNACCEPTABLE disputes with a pack (22). Listing outcome from a live read-only Shopify query; score/mode computed from the same inputs with the flag OFF vs ON.

## Summary

- Listing found: **22** of 22; other outcomes: none.
- Completeness score changes: 2 (up 2, down 0).
- Readiness changes: 2.
- Auto-save gate flips: 0 (block→auto_save 0, auto_save→block 0).
- Letter mode narrow→full: 21; full→narrow: 0.
- Existing letters that go stale (would rebuild): 22.

## Per dispute

| Order | Due | Listing | Templated | Stored score | Score off → on | Readiness off → on | Gate off → on | Mode off → on | Letter | Goes stale |
|---|---|---|---|---|---|---|---|---|---|---|
| #352552 | 2026-08-28 | present | no | 64 | 60 → 79 | ready_with_warnings → ready | auto_save → auto_save | narrow → full | v6 draft | yes |
| #352553 | 2026-08-28 | present | no | 64 | 60 → 79 | ready_with_warnings → ready | auto_save → auto_save | narrow → full | v9 submitted | yes |
| #96919 | 2026-09-10 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v3 draft | yes |
| #93953 | 2026-09-12 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v2 failed | yes |
| #95439 | 2026-09-18 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v2 failed | yes |
| #95311 | 2026-09-20 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v2 failed | yes |
| #99967 | 2026-09-25 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v2 skipped | yes |
| #102668 | 2026-09-28 | present | yes | 55 | 63 → 63 | ready → ready | block → block | narrow → narrow | v1 skipped | yes |
| #98483 | 2026-09-30 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #94866 | 2026-10-02 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v3 draft | yes |
| #101350 | 2026-10-02 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #100304 | 2026-10-03 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #99445 | 2026-10-03 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #100705 | 2026-10-04 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #99296 | 2026-10-05 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v2 draft | yes |
| #100072 | 2026-10-05 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #100017 | 2026-10-05 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #93670 | 2026-10-07 | present | yes | 74 | 70 → 70 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #99143 | 2026-10-10 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #100373 | 2026-10-11 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #101111 | 2026-10-15 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
| #93254 | 2026-10-16 | present | yes | 97 | 95 → 95 | ready → ready | block → block | narrow → full | v1 draft | yes |
