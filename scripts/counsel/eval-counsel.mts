/**
 * Counsel v2 offline eval (cost refactor §5). READ-ONLY against the database.
 *
 * For each item-not-received case: rebuild the claim ledger from production
 * inputs (latest package's facts + its evidence pack + a live Admin read of
 * the customer's orders), write the letter with the production code path
 * (writeCounselLetter), then run the JUDGE — which exists only here — and
 * report calls, tokens, estimated cost and the pass bar:
 *   - the judge decides for the merchant from the summary alone,
 *   - no unclear sentences,
 *   - the code checks pass on the first draft (bar: ≥ 2 of 3 cases).
 *
 * Model calls go through the staging pilot route (the local Anthropic key is
 * unusable); the route has no prompt caching, so reported cost is the
 * UNCACHED upper bound.
 *
 *   npx tsx scripts/counsel/eval-counsel.mts --env-file .env.production.local \
 *     --token-file <path to pilot.token> [--limit 8] [--dispute <uuid> ...]
 *
 * Output: scripts/.snapshots/counsel-eval/<timestamp>.{json,txt} (git-ignored:
 * it holds customer data).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
const envFile = arg("env-file");
const tokenFile = arg("token-file");
if (!envFile || !tokenFile) {
  console.error("usage: --env-file <file> --token-file <file> [--limit N] [--dispute <uuid> ...]");
  process.exit(1);
}
config({ path: envFile, override: true });

// Imported after the env is loaded: the Supabase client reads it at import.
const { getServiceClient } = await import("../../lib/supabase/server");
const { deriveOrderContext } = await import("../../lib/defence/orderContext");
const { buildItemNotReceivedLedger } = await import("../../lib/defence/counsel/claimLedger");
const { fetchCustomerOrders, COUNSEL_DEFAULT_MODEL, COUNSEL_REVIEW_MODEL } = await import("../../lib/defence/counsel/run");
const { writeCounselLetter, letterForJudge, parseJson } = await import("../../lib/defence/counsel/generate");
const { judgePrompt } = await import("../../lib/defence/counsel/prompts");
const { ITEM_NOT_RECEIVED } = await import("../../lib/defence/counsel/playbooks");
const { runCostUsd } = await import("../../lib/defence/counsel/cost");
const { isNonCardPaymentFamily } = await import("../../lib/disputes/paymentContext");
type Stage = import("../../lib/defence/counsel/run").CounselStageUsage;
type Verdict = import("../../lib/defence/counsel/types").JudgeVerdict;

const TOKEN = fs.readFileSync(tokenFile, "utf8").trim();
const ROUTE = "https://dev.disputedesk.app/api/public/pilot-inr-letter";

async function model(m: string, system: string, user: string, temperature?: number, maxTokens?: number) {
  const res = await fetch(ROUTE, {
    method: "POST",
    headers: { "x-pilot-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ system, user, model: m, temperature, maxTokens }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${t.slice(0, 300)}`);
  const j = JSON.parse(t) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  if (user.length > 12_000) console.warn(`  ! user message ${user.length} chars exceeds the route's 12k cut`);
  return { text: (j.content ?? []).map((c) => c.text ?? "").join(""), input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
}

const sb = getServiceClient();
const limit = Number(arg("limit") ?? "8");
let disputeIds = args("dispute");
if (!disputeIds.length) {
  // The most recent non-receipt disputes, #352543 first. Most are PayPal or
  // Klarna (skipped below, as in the job), so the pool is wide.
  const { data } = await sb
    .from("disputes")
    .select("id")
    .eq("reason", "PRODUCT_NOT_RECEIVED")
    .order("initiated_at", { ascending: false })
    .range(0, 999);
  disputeIds = [...new Set(["25034e1e-ab3e-4457-88d1-d1f9751f9a12", ...(data ?? []).map((r) => r.id as string)])];
}

const out: unknown[] = [];
const lines: string[] = [];
let evaluated = 0;
const seenOrders = new Set<string>();
for (const disputeId of disputeIds) {
  if (evaluated >= limit) break;
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("facts_json, source_pack_id, shop_id, version")
    .eq("dispute_id", disputeId)
    .neq("status", "failed")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pkg) continue;
  const [{ data: pack }, { data: d }, { data: shop }] = await Promise.all([
    sb.from("evidence_packs").select("pack_json").eq("id", pkg.source_pack_id).single(),
    sb.from("disputes").select("dispute_gid, order_gid, initiated_at, amount, currency_code").eq("id", disputeId).single(),
    sb.from("shops").select("shop_name, shop_domain").eq("id", pkg.shop_id).single(),
  ]);
  const sections = ((pack?.pack_json as { sections?: unknown[] } | null)?.sections ?? []) as Array<{
    type: string; label?: string; source?: string; data?: Record<string, unknown>; fieldsProvided?: string[];
  }>;
  // The job runs counsel for card disputes only (buildDefencePackageJob.ts).
  const family = (pack?.pack_json as { payment_context?: { family?: string } } | null)?.payment_context?.family ?? null;
  if (isNonCardPaymentFamily(family)) {
    lines.push(`- ${disputeId}: non-card payment (${family}) — the job never runs counsel, skipped`);
    continue;
  }
  const facts = (pkg.facts_json ?? []) as never[];
  const ctx = deriveOrderContext(sections.map((s) => ({ type: s.type, label: s.label ?? "", source: s.source ?? "", data: s.data ?? {}, fieldsProvided: s.fieldsProvided ?? [] })) as never);
  // One case per order (an inquiry and its chargeback share the order).
  if (ctx.orderName && seenOrders.has(`${pkg.shop_id}:${ctx.orderName}`)) continue;
  if (ctx.orderName) seenOrders.add(`${pkg.shop_id}:${ctx.orderName}`);
  const customerOrders = d?.order_gid ? await fetchCustomerOrders(pkg.shop_id, d.order_gid) : [];
  const ledger = buildItemNotReceivedLedger({
    moduleKey: "inr_product_not_received",
    facts,
    packSections: sections.map((s) => ({ type: s.type, source: s.source, data: s.data ?? {} })),
    orderName: ctx.orderName ?? null,
    disputeOpenedAt: d?.initiated_at ?? null,
    disputeAmount: Number.isFinite(Number(d?.amount)) ? Number(d?.amount) : null,
    disputeCurrency: d?.currency_code ?? null,
    customerOrders,
  });
  if (!ledger) {
    lines.push(`- ${ctx.orderName ?? disputeId}: no ledger (not a single carrier-confirmed delivery) — template writer, skipped`);
    continue;
  }
  evaluated++;
  const merchantName = shop?.shop_name?.trim() || "The merchant";
  const dv = ((facts as Array<{ category: string; value: Record<string, string> }>).find(
    (f) => (f.category === "delivery_proof" || f.category === "shipping_tracking") && f.value?.trackingNumber,
  )?.value ?? {}) as Record<string, string>;
  const disputeNumber = d?.dispute_gid?.split("/").pop() ?? null;
  const amountDisplay = d?.amount != null ? `${d.currency_code ?? ""} ${d.amount}`.trim() : null;
  const pageContext = [
    `Header: ${[disputeNumber && `Dispute ${disputeNumber}`, ctx.orderName && `Order ${ctx.orderName}`, amountDisplay].filter(Boolean).join(" · ")} · submitted on behalf of ${merchantName}.`,
    `Case details table: merchant, card network${ctx.cardLast4 ? `, card ending ${ctx.cardLast4}` : ""}, transaction date, order number, disputed amount.`,
    "Shipment card: carrier, tracking number, shipped and delivered dates. Tracking link printed below the shipping section.",
    "Line-items table: products, adjustments, total.",
    "Timeline: the order's events and the chargeback, with dates.",
  ].join("\n");

  const stages: Stage[] = [];
  const t0 = Date.now();
  const r = await writeCounselLetter({
    ledger,
    playbook: ITEM_NOT_RECEIVED,
    merchantName,
    pageContext,
    call: async ({ stage, system, user, temperature, maxTokens }) => {
      const m = stage === "review" ? (arg("review-model") ?? COUNSEL_REVIEW_MODEL) : COUNSEL_DEFAULT_MODEL;
      const res = await model(m, system, user, temperature, maxTokens);
      stages.push({ stage, model: m, input: res.input, output: res.output, cacheRead: 0, cacheWrite: 0 });
      return res.text;
    },
    check: {
      ledger,
      playbook: ITEM_NOT_RECEIVED,
      facts,
      disputeOpenedAt: d?.initiated_at ?? null,
      merchantName,
      carrierName: dv.carrier ?? null,
      pageIdentifiers: [ctx.orderName, ctx.orderName?.replace(/^#/, ""), dv.trackingNumber, ctx.cardLast4, amountDisplay?.match(/\d+(?:\.\d+)?/)?.[0], disputeNumber].filter(
        (x): x is string => !!x,
      ),
      trackingUrl: dv.trackingUrl ?? null,
    },
  });
  const seconds = (Date.now() - t0) / 1000;
  const jp = judgePrompt(letterForJudge(r.draft, pageContext));
  const verdict = parseJson<Verdict>((await model(COUNSEL_DEFAULT_MODEL, jp.system, jp.user, 0, 1500)).text);
  const pass = r.ok && verdict.decisionAfterSummaryOnly === "merchant" && (verdict.unclearSentences ?? []).length === 0;
  const cost = runCostUsd(stages);
  out.push({ disputeId, orderName: ctx.orderName, theory: r.theory.name, ok: r.ok, firstIssues: r.firstIssues, issues: r.issues, stages, cost, seconds, draft: r.draft, verdict, pass });
  lines.push(
    `\n=== ${ctx.orderName} (${merchantName}) theory=${r.theory.name}`,
    `calls ${stages.map((s) => s.stage).join(" → ")} · in ${stages.reduce((a, s) => a + s.input, 0)} / out ${stages.reduce((a, s) => a + s.output, 0)} · $${cost.toFixed(4)} uncached · ${seconds.toFixed(1)} s`,
    `first draft clean: ${r.firstIssues.length === 0} · letter ok: ${r.ok} · judge(summary) ${verdict.decisionAfterSummaryOnly} · unclear ${(verdict.unclearSentences ?? []).length} · PASS ${pass}`,
    ...(r.firstIssues.length ? [`first issues: ${r.firstIssues.join(" | ")}`] : []),
    ...(r.issues.length ? [`final issues: ${r.issues.join(" | ")}`] : []),
    `SUMMARY: ${r.draft.summary.paragraphs.join(" ")}`,
    ...r.draft.evidenceSections.map((s) => `${s.key.toUpperCase()}: ${s.paragraphs.join(" ")}`),
    `CONCLUSION: ${r.draft.conclusion.paragraphs.join(" ")}`,
    `judge red flags: ${JSON.stringify(verdict.redFlags)}`,
  );
  console.log(lines.slice(-6).join("\n"));
}

const rows = out as Array<{ pass: boolean; firstIssues: string[]; cost: number; stages: unknown[] }>;
const summary = [
  `\nCASES ${rows.length} · PASS ${rows.filter((x) => x.pass).length} · first draft clean ${rows.filter((x) => !x.firstIssues.length).length}`,
  `avg calls ${(rows.reduce((a, x) => a + x.stages.length, 0) / Math.max(1, rows.length)).toFixed(1)} · avg cost $${(rows.reduce((a, x) => a + x.cost, 0) / Math.max(1, rows.length)).toFixed(4)} (uncached upper bound)`,
];
console.log(summary.join("\n"));
const dir = path.join("scripts", ".snapshots", "counsel-eval");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dir, `${stamp}.txt`), [...lines, ...summary].join("\n"));
console.log(`report: ${path.join(dir, `${stamp}.txt`)}`);
