/**
 * Email evidence pack preview for a dispute.
 * Usage: node scripts/email-pack-preview.mjs <dispute-id>
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const disputeId = process.argv[2];
if (!disputeId) { console.error("Usage: node scripts/email-pack-preview.mjs <dispute-id>"); process.exit(1); }

async function main() {
  const { data: dispute } = await sb.from("disputes").select("*").eq("id", disputeId).single();
  const { data: pack } = await sb.from("evidence_packs").select("*").eq("dispute_id", disputeId).order("created_at", { ascending: false }).limit(1).single();
  const { data: items } = await sb.from("evidence_items").select("*").eq("pack_id", pack.id).order("created_at");
  const { data: rebuttal } = await sb.from("rebuttal_drafts").select("*").eq("pack_id", pack.id).eq("locale", "en-US").maybeSingle();

  // Shop domain for policy links
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", dispute.shop_id).single();
  const shopDomain = shop?.shop_domain ?? "unknown.myshopify.com";

  // Full policy texts
  const { data: allPolicies } = await sb.from("policy_snapshots").select("policy_type, url, extracted_text, captured_at").eq("shop_id", dispute.shop_id).order("captured_at", { ascending: false });
  const policyByType = new Map();
  for (const p of allPolicies ?? []) { if (!policyByType.has(p.policy_type)) policyByType.set(p.policy_type, p); }

  const orderName = dispute.order_name || "#" + disputeId.slice(0, 8);
  const sep = "=".repeat(65);
  const dash = (label) => `\u2500\u2500 ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`;

  let body = "";
  body += sep + "\n";
  body += `  DISPUTEDESK \u2014 EVIDENCE PACK PREVIEW\n`;
  body += `  Dispute ${orderName} \u2014 ${dispute.reason || "FRAUDULENT"}\n`;
  body += `  Amount: ${dispute.currency_code} ${dispute.amount}\n`;
  body += `  Completeness: ${pack.completeness_score}% | Readiness: ${pack.submission_readiness}\n`;
  body += sep + "\n\n";

  // Checklist
  body += dash("EVIDENCE CHECKLIST") + "\n\n";
  for (const c of pack.checklist_v2 || []) {
    const icon = c.status === "available" ? "\u2713" : c.status === "unavailable" ? "\u2014" : "\u2717";
    body += `  ${icon}  ${c.label} (${c.status})\n`;
  }
  body += "\n";

  // Rebuttal
  if (rebuttal?.sections) {
    body += dash("DISPUTE RESPONSE ARGUMENT") + "\n\n";
    for (const sec of rebuttal.sections) {
      if (sec.type === "summary") body += "[Summary]\n";
      else if (sec.type === "conclusion") body += "\n[Conclusion]\n";
      else body += "\n[Claim]\n";
      body += sec.text + "\n";
    }
    body += "\n";
  }

  // Evidence
  body += dash("COLLECTED EVIDENCE") + "\n\n";

  for (const item of items) {
    const p = item.payload;
    body += `\u250c\u2500 ${item.label}\n`;
    body += `\u2502  Source: ${item.source}\n`;

    if (item.type === "order") {
      body += "\u2502\n";
      body += `\u2502  Order: ${p.orderName || ""}\n`;
      body += `\u2502  Date: ${fmtDate(p.createdAt)}\n`;
      body += `\u2502  Status: ${p.financialStatus || ""} / ${p.fulfillmentStatus || ""}\n`;
      if (p.totals) body += `\u2502  Total: ${p.totals.currency} ${p.totals.total}\n`;
      if (p.billingAddress) body += `\u2502  Billing: ${fmtAddr(p.billingAddress)}\n`;
      if (p.shippingAddress) body += `\u2502  Shipping: ${fmtAddr(p.shippingAddress)}\n`;
      if (p.billingAddress && p.shippingAddress) {
        const match = p.billingAddress.city === p.shippingAddress.city && p.billingAddress.countryCode === p.shippingAddress.countryCode;
        body += `\u2502  Address match: ${match ? "\u2713 Billing matches shipping" : "\u2717 Addresses differ"}\n`;
      }
      if (p.customerTenure) body += `\u2502  Customer: since ${fmtDate(p.customerTenure.customerSince)}, ${p.customerTenure.totalOrders} prior orders\n`;
      if (p.lineItems?.length) {
        body += "\u2502\n\u2502  Line items:\n";
        for (const li of p.lineItems) {
          body += `\u2502    \u2022 ${li.title}${li.variantTitle ? " (" + li.variantTitle + ")" : ""} \u00d7 ${li.quantity} \u2014 ${li.currency || "USD"} ${li.total}\n`;
        }
      }
    }

    if (item.type === "other" && p.avsResultCode !== undefined) {
      body += "\u2502\n";
      body += `\u2502  AVS Result: ${p.avsResultCode || "N/A"}${p.avsResultCode === "Y" ? " (Address verified)" : ""}\n`;
      body += `\u2502  CVV Result: ${p.cvvResultCode || "N/A"}${p.cvvResultCode === "M" ? " (Matched)" : ""}\n`;
      body += `\u2502  Gateway: ${p.gateway || ""}\n`;
      body += `\u2502  Card: ${p.cardCompany || ""} ${p.lastFour || ""}\n`;
      if (p.cardholderName) body += `\u2502  Cardholder: ${p.cardholderName}\n`;
    }

    if (item.type === "comms") {
      body += "\u2502\n";
      if (p.orderNote) body += `\u2502  Order note: ${p.orderNote}\n`;
      if (p.timelineEvents?.length) {
        body += `\u2502  Order timeline (${p.timelineEvents.length} events):\n`;
        for (const e of p.timelineEvents) {
          const msg = (e.message || "").replace(/<[^>]+>/g, "");
          body += `\u2502    [${fmtDateTime(e.createdAt)}] ${msg}\n`;
        }
      }
    }

    if (item.type === "access_log") {
      body += "\u2502\n";
      if (p.customerTenure) {
        body += `\u2502  Account created: ${fmtDate(p.customerTenure.customerSince)}\n`;
        body += `\u2502  Total orders: ${p.customerTenure.totalOrders}\n`;
      }
    }

    if (item.type === "policy") {
      body += "\u2502\n";
      body += "\u2502  NOTE: All policies submitted to Shopify must be in English.\n";
      body += "\u2502  Non-English policies should be replaced with English versions\n";
      body += "\u2502  before submission.\n\u2502\n";
      for (const pol of p.policies || []) {
        const typeName = pol.policyType.charAt(0).toUpperCase() + pol.policyType.slice(1);
        const policySlug = { privacy: "privacy-policy", terms: "terms-of-service", refunds: "refund-policy", shipping: "shipping-policy" }[pol.policyType];
        const storeUrl = policySlug ? `https://${shopDomain}/policies/${policySlug}` : null;
        body += `\u2502  ${typeName} Policy (captured ${fmtDate(pol.capturedAt)})\n`;
        const full = policyByType.get(pol.policyType);
        if (full?.extracted_text) {
          const lines = full.extracted_text.split("\n").filter(l => l.trim() && !l.startsWith("#")).slice(0, 3);
          for (const line of lines) {
            body += `\u2502    ${line.trim()}\n`;
          }
          body += `\u2502    [...]\n`;
        }
        if (storeUrl) body += `\u2502    Full policy: ${storeUrl}\n`;
        body += "\u2502\n";
      }
    }

    body += `\u2514${"─".repeat(64)}\n\n`;
  }

  body += dash("END OF EVIDENCE PACK") + "\n";
  body += "\nGenerated by DisputeDesk \u2014 disputedesk.app\n";

  // Send
  const resend = new Resend(process.env.RESEND_API_KEY);
  const to = "oi@johan.com.br";
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "DisputeDesk <notifications@mail.disputedesk.app>",
    to,
    subject: `[DisputeDesk] Evidence Pack \u2014 Dispute ${orderName} ${dispute.reason || "FRAUDULENT"}`,
    text: body,
  });
  if (error) { console.error("Email error:", error); process.exit(1); }
  console.log(`\u2713 Email sent to ${to}`);
}

function fmtDate(iso) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtAddr(a) {
  if (!a) return "\u2014";
  return [a.city, a.provinceCode, a.countryCode].filter(Boolean).join(", ");
}

main().catch(e => { console.error(e); process.exit(1); });
