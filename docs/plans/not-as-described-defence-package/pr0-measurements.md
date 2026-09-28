# Not-as-described — PR 0 measurements (prod, read-only)

Measured 2026-09-28 against prod (`aokhplydttxtebvbeuzc`, guard-verified per command). Plan: `../not-as-described-defence-package.plan.md`.

## 1. Scope grants — `scripts/sql/product-scope-grants.sql`

| Shop | Offline session | `read_products` | Not-as-described disputes (all time) |
|---|---|---|---|
| 6a8848-dd | 2026-09-09 | yes | 277 |
| blume-box | 2026-09-27 | yes | 24 |
| surasvenne | 2026-09-28 | yes | 4 |
| cay-collective | 2026-07-15 | yes | 3 |

Every installed shop has granted `read_products`. The collector's `inaccessible` path covers future installs and revocations only.

## 2. Exposure — `scripts/sql/product-disputes-summary.sql`, `product-disputes-open.sql`

308 PRODUCT_UNACCEPTABLE disputes: 30 open, 278 decided. **0 of 308 packs carry an available product listing.**

Open disputes (30):

| Phase | Defence package mode | Strength | n | Templated pack |
|---|---|---|---|---|
| chargeback | narrow | moderate | 8 | 8 |
| inquiry | narrow | moderate | 7 | 7 |
| chargeback | full | moderate | 5 | 3 |
| chargeback | none yet | moderate / weak / no pack | 10 | 2 |

- **15 open letters are `narrow`** — the hedged framing PR 1 removes. All are on 6a8848-dd.
- Strength is `moderate` (not weak) on almost all packs: the shipped two-axis branch already credits Axis 2 (no return recorded). The letters are narrow because the family's critical category `product_listing` is always missing (`derivePackageMode`, `factClassifier.ts:1089-1097`), not because the case is weak.
- Therefore, once PR 3's collector supplies a listing and the flag is ON, most of these would move `narrow → full`. That is the flag-ON replay's job (PR 3); it is not measured here.
- Decided, with a defence package: full 24 (won 16, lost 8), narrow 20 (won 9, lost 11). Too few and too confounded to claim that framing caused the outcome.

## 3. Regression fixture — `scripts/sql/product-order-90627.sql`

Order #90627 = 6a8848-dd, dispute `f9343844-86f5-45be-82bb-a01505501736`, PRODUCT_UNACCEPTABLE, **won** (due 2026-08-30). Used as a fixture only; never refiled.

## 4. D4 — should a collected listing count as Axis-1? — `scripts/evidence-model/productListingAxis1.analysis.ts`

Every scored pack (71 with a pack; the other 237 are historical disputes without one) given an available listing, scored by the real `calculateCaseStrength` with the listing as shipped (supportingOnly) and as an Axis-1 signal. The sanity check held: adding a supportingOnly listing moved 0 tiers.

| State | Today → if listing were Axis-1 | n |
|---|---|---|
| open | moderate → **strong** | 21 |
| open | weak → moderate | 1 |
| open | weak → weak | 1 |
| decided | moderate → **strong** | 45 (won 25, lost 20) |
| decided | weak → moderate | 3 (won 2, lost 1) |

**Finding: counting the listing as Axis-1 would make 66 of 71 packs Strong** — every case that already has "no return recorded" — and Strong auto-submits. On decided cases those "would-be Strong" disputes won 25 of 45 (56%), which is not what Strong is meant to mean. A listing shows what was advertised, not that the delivered item matched it; promoting it would inflate strength across the family.

**Recommendation for PR 5: do not promote the listing.** Keep it `supportingOnly`; it improves the letter (PR 1/PR 3), not the tier. No scoring change is proposed.
