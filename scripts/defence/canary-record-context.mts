/**
 * Bank-claim plan F1/F2 release gate. READ-ONLY against the database.
 *
 * `--dispute <uuid>` (repeatable): rebuild what the letter would be given with
 * THIS checkout's classifier, plan and claim handling — the same steps as
 * buildDefencePackageJob, minus every write — then write the letter through the
 * staging pilot route (the local Anthropic key is unusable) and run the
 * narrative and composed-document validators. Prints which facts the letter
 * gains or loses against the latest stored package.
 *
 * `--parity <uuid>` (repeatable): for a claim-typed case, compare the latest
 * package's stored `plan_input_hash` with the hash the filing-time check
 * derives, the pre-F2 way (Shopify's reason) and this checkout's way.
 *
 *   npx tsx scripts/defence/canary-record-context.mts --env-file .env.production.local \
 *     --token-file <pilot.token> --out <file.json> --dispute <uuid> [--parity <uuid>]
 */
import fs from "node:fs";
import { config } from "dotenv";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
const envFile = arg("env-file");
const tokenFile = arg("token-file");
const out = arg("out");
const disputeIds = args("dispute");
const parityIds = args("parity");
const withListing = process.argv.includes("--with-listing");
const pdfDir = arg("pdf"); // --pdf <dir>: also render the full letter PDF (never stored or sent)
if (!envFile || !out || (disputeIds.length > 0 && !tokenFile)) {
  console.error("usage: --env-file <f> --out <f.json> [--token-file <f> --dispute <uuid> ...] [--parity <uuid> ...]");
  process.exit(1);
}
config({ path: envFile, override: true });

const { getServiceClient } = await import("../../lib/supabase/server");
const { BASE_SYSTEM_PROMPT, buildLlmFactPayload } = await import("../../lib/defence/narrativeWriter");
const { resolveCaseReasonCodeModule, familyKeyForModule } = await import("../../lib/defence/reasonCodes/registry");
const { getFamily } = await import("../../lib/defence/reasonCodes/familyRegistry");
const { rankStrategies } = await import("../../lib/defence/strategies/registry");
const { paymentOverlayFor } = await import("../../lib/defence/paymentOverlays");
const { classifyFacts, hasArgumentBeyondRecordContext } = await import("../../lib/defence/factClassifier");
const { derivePlanForCase, planHasSafeArgument } = await import("../../lib/argument/plan");
const { selectPlanFacts, derivePlanIdentityForPack } = await import("../../lib/defence/package");
const { bankIncludedFacts } = await import("../../lib/defence/bankInclusion");
const { effectiveReasonForClaim, scopeFactsToBankClaim } = await import("../../lib/disputes/bankClaimAnalysis");
const { isNonCardPaymentFamily } = await import("../../lib/disputes/paymentContext");
const { validateNarrative, validateComposedDocument } = await import("../../lib/defence/validateNarrative");
const { composePdfBlocks } = await import("../../lib/defence/pdf/composePdfBlocks");
const { disputedAmountDisplay } = await import("../../lib/defence/shipmentRecordSections");
type Narrative = import("../../lib/defence/types").DefenceNarrativeOutput;

const ROUTE = "https://dev.disputedesk.app/api/public/pilot-inr-letter";
const SECTIONS = [
  "executiveSummary", "transactionOverviewArgument", "chronologyArgument", "paymentAuthenticationArgument",
  "fulfillmentArgument", "communicationArgument", "policyArgument", "manualEvidenceArgument", "conclusion",
] as const;

function parse(raw: string): Narrative | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try {
    const p = JSON.parse(raw.slice(s, e + 1)) as Record<string, { text?: unknown; usedFactIds?: unknown }> & {
      omittedSections?: { sectionKey: string; reason?: string }[];
      warnings?: unknown[];
    };
    const n: Record<string, unknown> = {};
    for (const k of SECTIONS) {
      const sec = p[k];
      if (!sec || typeof sec.text !== "string" || !Array.isArray(sec.usedFactIds)) return null;
      n[k] = { text: sec.text, usedFactIds: sec.usedFactIds.filter((x) => typeof x === "string") };
    }
    n.omittedSections = (p.omittedSections ?? []).map((o) => ({ sectionKey: o.sectionKey, reason: o.reason ?? "" }));
    n.warnings = (p.warnings ?? []).filter((x) => typeof x === "string");
    return n as unknown as Narrative;
  } catch {
    return null;
  }
}

const sb = getServiceClient();

async function liveListingSection(shopId: string, orderGid: string) {
  const crypto = await import("node:crypto");
  const { PRODUCT_EVIDENCE_QUERY } = await import("../../lib/shopify/queries/productEvidence");
  const { excerptOf } = await import("../../lib/packs/productListing/collectProductListings");
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", shopId).single();
  const { data: sess } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", shopId)
    .eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).single();
  const [v, iv, tag, c] = String(sess!.access_token_encrypted).split(":");
  const key = process.env[`TOKEN_ENCRYPTION_KEY_V${v.replace(/^v/, "")}`] || process.env.TOKEN_ENCRYPTION_KEY!;
  const dec = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
  dec.setAuthTag(Buffer.from(tag, "hex"));
  const token = dec.update(Buffer.from(c, "hex"), undefined, "utf8") + dec.final("utf8");
  const r = await fetch(`https://${shop!.shop_domain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-01"}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ query: PRODUCT_EVIDENCE_QUERY, variables: { id: orderGid, after: null } }),
  });
  const j = (await r.json()) as { data?: { order?: { lineItems?: { nodes: Array<Record<string, any>> } } } };
  const listings = (j.data?.order?.lineItems?.nodes ?? [])
    .filter((li) => li.product && (li.product.title || li.product.description))
    .map((li) => ({
      snapshotId: "canary", lineItemGid: li.id, contentHash: "canary", productGid: li.product.id,
      title: li.product.title, variantTitle: li.variant?.title ?? null,
      variantOptions: li.variant?.selectedOptions ?? [],
      excerpt: li.product.description ? excerptOf(String(li.product.description), 600) : null,
      sourceUrl: li.product.onlineStoreUrl ?? null, fetchedAt: new Date().toISOString(), imagePaths: [],
      imageUrls: [li.variant?.image?.url, ...((li.product.media?.nodes ?? []).map((m: any) => m.image?.url))].filter(Boolean).slice(0, 3),
      lineTotal: Number(li.originalTotalSet?.shopMoney?.amount) || null,
    }))
    .sort((a, b) => (b.lineTotal ?? 0) - (a.lineTotal ?? 0));
  if (!listings.length) return null;
  return { type: "other", label: "Product listings", source: "shopify_product", data: { listings, outcomes: [] }, fieldsProvided: ["product_description"] };
}

async function load(disputeId: string) {
  const { data: d } = await sb
    .from("disputes")
    .select("id, shop_id, order_gid, order_name, dispute_gid, reason, network_reason_code, amount, currency_code, initiated_at, response_cycle, customer_display_name")
    .eq("id", disputeId)
    .single();
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("id, version, status, facts_json, plan_input_hash, source_pack_id")
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, pack_json, checklist_v2")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const { data: itemsRaw } = await sb.from("evidence_items").select("id, payload, source").eq("pack_id", pack!.id);
  const items = (itemsRaw ?? []).map((it) => ({
    id: it.id as string,
    payload: it.payload as (Record<string, unknown> & { fieldsProvided?: string[] }) | null,
    source: (it.source as string | null) ?? null,
  }));
  const checklist = ((pack!.checklist_v2 as Array<{ field: string; status: string }> | null) ?? []).map((c) => ({
    field: c.field,
    status: c.status as never,
  }));
  const { data: claimRow } = await sb
    .from("dispute_bank_claims")
    .select("claim_text, analysis")
    .eq("dispute_id", disputeId)
    .eq("response_cycle", d!.response_cycle ?? 1)
    .maybeSingle();
  return { d: d!, pkg, pack: pack!, items, checklist, claimRow };
}

const results: unknown[] = [];

for (const disputeId of disputeIds) {
  const { d, pkg, pack, items, checklist, claimRow } = await load(disputeId);
  const packJson = (pack.pack_json ?? {}) as Record<string, unknown>;
  const sections = [...((packJson.sections as Array<{
    type: string; label: string; source: string; data: Record<string, unknown>; fieldsProvided: string[];
  }>) ?? [])];
  // --with-listing: what the product-listing collector (not-as-described
  // PR 3) would add — read live from Shopify, READ-ONLY (nothing stored).
  // A pack the collector already ran on carries its stored listing; use it,
  // exactly as the job does.
  const storedListing = sections.some((x) => x.source === "shopify_product");
  if (withListing && d.order_gid && !storedListing) {
    const section = await liveListingSection(d.shop_id as string, d.order_gid as string);
    if (section) sections.push(section);
  }
  const family = (packJson.payment_context as { family?: string } | undefined)?.family ?? null;
  const analysis = (claimRow?.analysis ?? null) as Parameters<typeof scopeFactsToBankClaim>[1] & { reason?: string } | null;
  const claimReason = effectiveReasonForClaim(d.reason, analysis as never);
  const module = resolveCaseReasonCodeModule({
    networkReasonCode: d.network_reason_code,
    shopifyReason: d.reason,
    caseReason: claimReason,
    nonCardPayment: isNonCardPaymentFamily(family),
  });
  const fam = getFamily(familyKeyForModule(module.key));
  const coverage = (packJson.coverage as { state?: string } | undefined)?.state ?? "not_covered";
  const fatal = (packJson.fatal_loss as { triggered?: boolean; reason?: string | null } | undefined) ?? { triggered: false, reason: null };
  const { data: manualRaw } = pkg
    ? await sb
        .from("defence_manual_evidence")
        .select("id, evidence_item_id, filename, file_url, file_type, uploaded_by, uploaded_at, description, bank_eligible, include_in_package, include_in_bank_narrative, evidence_category")
        .eq("package_id", pkg.id)
    : { data: [] };
  const classification = classifyFacts({
    packageId: pkg?.id ?? "canary",
    sections: sections.map((s) => ({ type: s.type, label: s.label, source: s.source, data: s.data ?? {}, fieldsProvided: s.fieldsProvided ?? [] })),
    evidenceItems: items,
    checklist,
    coverage: { state: coverage === "covered_shopify" ? "covered_shopify" : "not_covered" },
    fatalLoss: { triggered: fatal.triggered === true, reason: fatal.reason ?? null },
    caseStrength: "moderate",
    manualRows: (manualRaw ?? []).map((m) => ({
      id: m.id, evidenceItemId: m.evidence_item_id, filename: m.filename, fileUrl: m.file_url ?? null,
      fileType: m.file_type ?? null, uploadedBy: m.uploaded_by ?? null, uploadedAt: m.uploaded_at ?? null,
      description: m.description ?? null, bankEligible: m.bank_eligible, includeInPackage: m.include_in_package,
      includeInBankNarrative: m.include_in_bank_narrative, evidenceCategory: m.evidence_category ?? null,
    })),
    reasonCodeModule: module,
  });
  const planned = derivePlanForCase({
    caseId: disputeId,
    model: {
      disputeId, reason: claimReason, packId: pack.id, sections, evidenceItems: items,
      coverage: { state: coverage }, networkReasonCode: d.network_reason_code,
    },
    reasonCodeModule: module,
    approvedFacts: classification.approved,
    reviewItems: [],
    computedAt: new Date().toISOString(),
  });
  let facts = bankIncludedFacts(selectPlanFacts(planned.plan, planned.factsByRecordId).includedFacts);
  if (analysis) facts = scopeFactsToBankClaim(facts, analysis).facts as typeof facts;
  const oldCats = ((pkg?.facts_json ?? []) as Array<{ category: string }>).map((f) => f.category).sort();
  const newCats = facts.map((f) => f.category).sort();
  const wouldSkip = !classification.eligible || !planHasSafeArgument(planned.plan) || !hasArgumentBeyondRecordContext(facts);
  const summary = {
    disputeId, order: d.order_name, module: module.key, claimReason,
    previousPackage: pkg ? `v${pkg.version} ${pkg.status}` : null,
    factsBefore: oldCats, factsAfter: newCats,
    gained: newCats.filter((c) => !oldCats.includes(c)), lost: oldCats.filter((c) => !newCats.includes(c)),
    wouldSkip,
  };
  console.log(JSON.stringify(summary));
  if (wouldSkip) {
    results.push({ ...summary, narrative: null });
    continue;
  }

  const strategies = rankStrategies({ familyKey: fam.key, predicateEvaluations: classification.predicateEvaluations, packageMode: classification.packageMode });
  const { overlay: paymentOverlay, prohibitedPhrases } = paymentOverlayFor(family, { shopifyReason: d.reason, subProduct: null });
  const input = {
    packageId: pkg?.id ?? "canary", disputeId, reasonCode: d.network_reason_code, reasonCodeModule: module,
    familyOverlay: fam.overlayPromptBody || null, paymentOverlay, strategies, packageMode: classification.packageMode,
    caseStrength: "moderate" as const, approvedFacts: facts, manualEvidence: classification.manual,
    internalOnlyFactIds: classification.internalOnly.map((f) => f.id), missingEvidence: classification.missing,
    bankClaim: claimRow?.claim_text ? { text: claimRow.claim_text as string, noClaimShown: false } : null,
  };
  const system = [BASE_SYSTEM_PROMPT, input.familyOverlay, paymentOverlay, module.promptBody, strategies.map((s) => s.promptBody).join("\n\n---\n\n")]
    .filter((b): b is string => !!b && b.trim().length > 0)
    .join("\n\n");
  const hard = [...fam.prohibitedBankPhrases, ...prohibitedPhrases];
  // One attempt, and — as in the job — ONE retry with the validator's errors
  // fed back as `retryGuidance`.
  const attempt = async (feedback: string[] | null) => {
    const payload = buildLlmFactPayload(input as never) as Record<string, unknown>;
    if (feedback) {
      payload.retryGuidance = {
        attempt: "second",
        previousAttemptErrors: feedback,
        directive:
          "Your previous response was rejected by the fact-grounding validator for the errors above. Rewrite the affected sections using only language that is supported by approvedFacts. If a claim cannot be grounded in an approved fact, omit it entirely.",
      };
    }
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: { "x-pilot-token": fs.readFileSync(tokenFile!, "utf8").trim(), "content-type": "application/json" },
      body: JSON.stringify({ system, user: JSON.stringify(payload), model: "claude-sonnet-4-6", temperature: 0.2, maxTokens: 4096 }),
    });
    const body = (await res.json()) as { text?: string; raw?: string; content?: { text: string }[]; error?: string };
    const raw = body.text ?? body.raw ?? body.content?.map((c) => c.text).join("") ?? "";
    const narrative = parse(raw);
    const narrativeCheck = narrative
      ? validateNarrative({ narrative, approvedFacts: facts, reasonCodeModule: module, packageMode: classification.packageMode, internalOnlyFactIds: input.internalOnlyFactIds, extraHardPhrases: hard, guardedPhrases: fam.guardedBankPhrases } as never)
      : null;
    const blocks = narrative
      ? composePdfBlocks({
          narrative, approvedFacts: facts, packageMode: classification.packageMode, familyKey: fam.key, moduleKey: module.key,
          fulfillmentStatus: null,
          caseContext: { orderName: d.order_name, disputeOpenedAt: d.initiated_at, disputedAmount: disputedAmountDisplay(Number(d.amount), d.currency_code) },
        } as never)
      : [];
    const composedCheck = narrative
      ? validateComposedDocument({ blocks, approvedFacts: facts, packageMode: classification.packageMode, extraHardPhrases: hard, guardedPhrases: fam.guardedBankPhrases } as never)
      : null;
    return { res, body, raw, narrative, narrativeCheck, composedCheck, blocks };
  };
  const first = await attempt(null);
  const firstErrors = first.narrativeCheck && !first.narrativeCheck.ok
    ? first.narrativeCheck.errors.map((e: { section?: string; message?: string }) => `${e.section ?? "narrative"}: ${e.message ?? "validation failed"}`)
    : null;
  const final = firstErrors ? await attempt(firstErrors) : first;
  const { res, body, raw, narrative, narrativeCheck, composedCheck, blocks } = final;
  if (pdfDir && narrative && narrativeCheck?.ok && composedCheck?.ok) {
    const { renderDefencePdf } = await import("../../lib/defence/renderDefencePdf");
    // Mirror buildDefencePackageJob's header fields, so the preview matches
    // what the job will print.
    const { nonCardDisputeCategoryDisplay } = await import("../../lib/defence/klarnaDisputeCategory");
    const { displayShopDomain } = await import("../../lib/shopify/domainHost");
    const { data: shopRow } = await sb.from("shops").select("shop_domain, primary_domain").eq("id", d.shop_id).single();
    const merchantDisplayName = shopRow?.shop_domain
      ? displayShopDomain({ shop_domain: shopRow.shop_domain as string, primary_domain: (shopRow.primary_domain as string | null) ?? null })
      : "Merchant";
    const { deriveOrderContext } = await import("../../lib/defence/orderContext");
    const { printable, displayUrl, EXHIBIT_LIMITS, buildProductListingExhibits } = await import("../../lib/defence/productListingExhibit");
    const { evidenceImageUrl } = await import("../../lib/packs/productListing/collectProductListings");
    const oc = deriveOrderContext(sections as never);
    const listingSection = sections.find((x) => x.source === "shopify_product");
    let budget = EXHIBIT_LIMITS.imagesPerPdf;
    const exhibits = [];
    for (const l of ((listingSection?.data?.listings ?? []) as Array<Record<string, any>>)) {
      const images: string[] = [];
      for (const u of (l.imageUrls ?? []) as string[]) {
        if (budget <= 0) break;
        const r = await fetch(evidenceImageUrl(u));
        if (!r.ok) continue;
        const b = new Uint8Array(await r.arrayBuffer());
        const mime = b[0] === 0xff ? "image/jpeg" : b[0] === 0x89 ? "image/png" : null;
        if (!mime) continue;
        images.push(`data:${mime};base64,${Buffer.from(b).toString("base64")}`);
        budget--;
      }
      exhibits.push({
        title: printable(l.title), variantLine: (l.variantOptions ?? []).filter((o: any) => !/^title$/i.test(o.name)).map((o: any) => `${o.name}: ${o.value}`).join(" · ") || null,
        excerpt: printable(l.excerpt), sourceUrl: l.sourceUrl ?? null, sourceUrlDisplay: displayUrl(l.sourceUrl ?? null),
        retrievedOn: String(l.fetchedAt).slice(0, 10), images,
      });
    }
    const out = await renderDefencePdf({
      meta: {
        packageId: "demo", disputeGid: d.dispute_gid ?? null, orderName: oc.orderName ?? d.order_name, reasonCode: d.network_reason_code,
        reasonCodeDisplay: isNonCardPaymentFamily(family) ? nonCardDisputeCategoryDisplay(family, (packJson.payment_context as { label?: string } | undefined)?.label ?? null, d.reason) : module.displayName, claimType: module.claimType, shopName: merchantDisplayName, merchantName: merchantDisplayName,
        amountDisplay: `${d.currency_code ?? ""} ${d.amount}`.trim(), cardNetwork: oc.cardNetwork, cardLast4: oc.cardLast4,
        paymentGateway: oc.paymentGateway, financialStatus: oc.financialStatus, fulfillmentStatus: oc.fulfillmentStatus,
        cardholderName: oc.cardholderName ?? (d.customer_display_name as string | null) ?? null, transactionDate: oc.transactionDate, timelineEvents: oc.timelineEvents,
        lineItemsFromContext: oc.lineItems, productListingExhibits: storedListing
          ? await buildProductListingExhibits({
              sb,
              sections: sections as never,
              listingCited: (facts as Array<{ category?: string; value?: { collected?: unknown } }>).some(
                (f) => f.category === "product_listing" && f.value?.collected === true,
              ),
            })
          : exhibits, generatedAt: new Date().toISOString(),
        version: 0, packageMode: classification.packageMode, promptVersion: 0, modelUsed: "claude-sonnet-4-6",
        reasonCodeModuleKey: module.key, reasonCodeFamilyKey: fam.key,
      } as never,
      composedBlocks: blocks as never, approvedFacts: facts as never, manualEvidence: [],
    });
    fs.writeFileSync(`${pdfDir}/demo-${String(d.order_name).replace("#", "")}.pdf`, out.buffer);
    console.log(`pdf written (${out.buffer.length} bytes)`);
  }
  const citedRecordFacts = narrative
    ? SECTIONS.flatMap((k) => (narrative as never as Record<string, { usedFactIds: string[] }>)[k].usedFactIds)
        .map((id) => facts.find((f) => f.id === id)?.category)
        .filter((c): c is string => !!c && ["policy_refund", "policy_shipping", "policy_cancellation", "order_record"].includes(c))
    : [];
  results.push({
    ...summary, http: res.status, error: body.error ?? null, retried: !!firstErrors, firstAttemptErrors: firstErrors,
    citedRecordFacts: [...new Set(citedRecordFacts)],
    narrative: narrative ? Object.fromEntries(SECTIONS.map((k) => [k, (narrative as never as Record<string, { text: string }>)[k].text])) : raw.slice(0, 2000),
    narrativeValidation: narrativeCheck ? { ok: narrativeCheck.ok, errors: narrativeCheck.errors } : null,
    composedValidation: composedCheck ? { ok: composedCheck.ok, errors: composedCheck.errors } : null,
  });
  console.log(`${d.order_name}: http ${res.status} retried=${!!firstErrors} narrative=${narrativeCheck?.ok} composed=${composedCheck?.ok} cites=${citedRecordFacts.join(",")}`);
}

for (const disputeId of parityIds) {
  const { d, pkg, pack, items, checklist } = await load(disputeId);
  const packJson = (pack.pack_json ?? {}) as Record<string, unknown>;
  const base = { caseId: disputeId, packId: pack.id, evidenceItems: items, checklist, disputeReason: d.reason, networkReasonCode: d.network_reason_code };
  const { case_assessment_reason: _drop, ...withoutClaim } = packJson;
  const preF2 = derivePlanIdentityForPack({ ...base, packJson: withoutClaim });
  const now = derivePlanIdentityForPack({ ...base, packJson });
  const row = {
    disputeId, order: d.order_name, shopifyReason: d.reason, assessedReason: packJson.case_assessment_reason ?? null,
    package: pkg ? `v${pkg.version} ${pkg.status}` : null, stored: pkg?.plan_input_hash ?? null,
    preF2Matches: pkg?.plan_input_hash === preF2.planInputHash, preF2Module: preF2.plan.reasonModuleId,
    thisCheckoutModule: now.plan.reasonModuleId,
  };
  console.log(JSON.stringify(row));
  results.push({ parity: row });
}

fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`wrote ${out}`);
