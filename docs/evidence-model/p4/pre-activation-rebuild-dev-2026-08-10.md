# §9.3 pre-activation rebuild — DEV run

> **Status: BLOCKED on a credential, not on the code.** The rebuild was enqueued through the
> authorized writer and could not execute; **nothing was written and nothing moved.**
> **Target:** dev `vrpkgudqmpyunekrkpnc` (guard confirmed before every command). Prod untouched.
> **Baseline:** `develop@30f24cba` (PR #525 merged) · **Run:** 2026-08-10
> **Scripts:** [`scripts/cp-pre-activation-rebuild.mjs`](../../../scripts/cp-pre-activation-rebuild.mjs) · [`scripts/cp-rebuild-verify.mjs`](../../../scripts/cp-rebuild-verify.mjs)

---

## 1. The authorized writer

`build_pack` → `handleBuildPack` → `lib/packs/buildPack.ts`, which writes
`pack_json.case_assessment` and `pack_json.case_assessment_gates` (CP-A). `buildPackJob` then
chains to `maybeEnqueueDefencePackage`, which enqueues `build_defence_package` →
`handleBuildDefencePackage`, the writer of `plan_json` and the canonical identity columns (CP-B).

Both are reachable **only** through `app/api/jobs/worker/route.ts`. §9.3 requires an explicit
authorized writer and forbids a GET/read path; this is that writer, and it is the same chain
production runs.

`cp-pre-activation-rebuild.mjs` **enqueues and stops**. It writes no pack, no snapshot, no plan and
no package. A script that wrote the fields directly would prove nothing about the path that will
write them in production.

## 2. Population

Per §9.4: `disputes.final_outcome IS NULL`, and the **latest** pack for that dispute has
`saved_to_shopify_at IS NULL`. Never `evidence_packs.status` — a pack that clears the gate is
immediately rewritten to `saved_to_shopify`.

| Measure | Count |
|---|---|
| Open disputes | 37 |
| …with a pack | 37 |
| **Open + unsubmitted — the population** | **17** |
| …already carrying a canonical assessment | 0 |

Dev holds exactly one shop: `surasvenne.myshopify.com`.

## 3. What happened

17 `build_pack` jobs enqueued at **priority 500** — below the interactive tier (20) and below the
default (100), so a merchant action always overtakes the rebuild.

They did not run:

1. **Dev crons are gated off.** `/api/jobs/worker` on `dev.disputedesk.app` answers **204** because
   `cronEnvGate` short-circuits when `CRON_ENABLED !== "true"`. That is deliberate dev
   configuration, not a fault. The `CRON_SECRET` is correct — a wrong one answers 401.
2. **The dev store's offline token is no longer accepted by Shopify.** Driving the worker locally
   against dev (same route, same handler) returned:

   > `Shopify rejected the offline token for shop surasvenne.myshopify.com: [API] Non-expiring
   > access tokens are no longer accepted for the Admin API.`

   `ShopifyAuthInvalidError` is thrown in the session preflight, **before** `buildPack` runs.

**Zero side effects, verified.** The job was released back to `queued` (17 queued, 0 failed, 0
done); no pack row was written; no partial or failed pack was created; no `case_assessment` exists
anywhere. The failure is at the credential boundary and leaves no trace.

### Why this must not be forced

`buildPack` tolerates a failed order fetch and produces a `status: failed` pack — and it still
writes a `case_assessment`. Three of the five gates come from the Shopify order. Forcing the
rebuild past an unusable token would therefore persist canonical snapshots derived from an order
that could not be read: a **wrong** snapshot, written by the authorized writer, indistinguishable
downstream from a correct one. Not running is strictly better than running against a dead token.

**To unblock:** one embedded load of the dev app in the `surasvenne` store, which replaces the
legacy non-expiring token with an expiring one (see `[[project_offline_tokens_deadline]]`, PR #284).
That is a browser action in the store's Shopify admin — it cannot be done from here, and the
client-credentials grant does not apply because this is a real merchant store, not a dev/custom-app
store.

## 4. Verification, as it stands

Run with `cp-rebuild-verify.mjs` against the BEFORE snapshot taken before the first job was queued.

| Check | Result |
|---|---|
| Legacy-read field changes (all 37 open packs, not just the 17) | **0** |
| Legacy disposition changes (`files` / `does_not_file`) | **0** |
| New pack rows since BEFORE | **0** |
| Population reconciliation | 17 → 17 · 0 joined · 0 left |
| Population with `case_assessment` | **0 / 17** |
| Canonical identity columns on dev | **present** (migration `20260810120000` applied) |
| Open packages carrying `plan_json` / `plan_input_hash` | 0 / 42 |
| Packages `final` + `validation ok` + not superseded | 5 |
| …of those, carrying a plan hash | **0** — all stale by construction |

**"Legacy path undisturbed: YES" is true and currently weak.** Nothing ran, so nothing could have
disturbed it. The value of this run is that the BEFORE file, the diff and the reconciliation are in
place and proven to work; the same verifier re-run after a successful rebuild is the result that
carries weight.

### A verifier defect found and fixed here

The first version selected `policy_version` and `artifact_id` from `defence_packages`. The
migration adds neither — they are contract fields, not columns — so PostgREST answered 400 and the
script reported **"migration not applied"** against a database that had applied it. Corrected to
the seven columns `20260810120000` actually adds. Worth recording because the false reading was the
reassuring one in the wrong direction: it would have sent someone to re-apply a migration instead
of looking at the token.

## 5. Two limitations dev cannot resolve

1. **P-7's canonical branch cannot be exercised on dev at all.** The only shop on dev is
   `surasvenne`, which is the shop P-7 **excludes** — no disposition-preserving threshold exists for
   it at any value. `blume-box`, the single activated shop, has no data on dev. So even a fully
   successful dev rebuild would leave P-7 measured at 0 canonical resolutions. It can only be
   exercised in production.
2. **The §9.3 precondition re-check needs prod.** "The rebuild must not change what the legacy path
   reads or files" was verified as 0 of 104 on production in the whole-pipeline replay, and 0 of 37
   here — but in both cases with `resolveEffectiveCompleteness` answering `legacy` everywhere,
   because no pack carries a snapshot yet. The check becomes load-bearing only once activated-shop
   packs carry usable snapshots, which is the state the rebuild creates.

## 6. State left behind

- 17 `build_pack` jobs **queued** on dev at priority 500. Left in place deliberately: they are
  exactly the work to run once the token is refreshed, and no worker runs on dev unattended
  (`CRON_ENABLED` is not `true`), so they cannot churn.
- `tmp/cp-rebuild-before-dev.json` — the BEFORE snapshot, still valid for the eventual re-run.
- No production database access of any kind in this run.
