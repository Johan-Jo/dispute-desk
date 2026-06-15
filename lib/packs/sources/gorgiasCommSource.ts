/**
 * Gorgias helpdesk-communication evidence source collector.
 *
 * Pulls the disputing customer's customer-service conversations from a
 * connected Gorgias account and snapshots them into the evidence pack —
 * the same pattern Chargeflow uses (conversation history → chargeback
 * evidence).
 *
 * Matching: the order's customer email (ctx.order.email) is resolved to a
 * Gorgias customer, whose non-trashed/non-spam tickets are pulled.
 *
 * Self-incrimination guard (critical): only `public === true` messages
 * are emitted. Internal agent notes (`public:false` / channel
 * "internal-note") — e.g. "just refund this sketchy customer" — would be
 * a confession if they reached the pack, so they are dropped.
 *
 * Snapshot, not live-link: Gorgias permanently purges trashed tickets
 * (~30 days) and GDPR-deletes customer profiles, so the message text is
 * frozen into the section `data` at build time rather than referenced
 * live at submission time.
 *
 * Strength: emits the existing canonical field `customer_communication`,
 * which classifies as `supporting` by default. It only upgrades to
 * `strong` when `data.customerConfirmsOrder === true` — Phase 1 never
 * sets that automatically (no fragile keyword detection); explicit
 * confirmation handling is a deliberate future step.
 *
 * Phase 1 is read-only/private-app and does NOT re-host attachments
 * (text snapshot only). Attachment byte capture is a Phase 1.5 follow-up.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import {
  createGorgiasClient,
  type GorgiasClient,
  type GorgiasCredentials,
  type GorgiasMessage,
} from "@/lib/integrations/gorgias/client";
import type { EvidenceSection, BuildContext } from "../types";

/** Test seam: lets the collector test inject credentials + a fake client
 *  without standing up Supabase or mocking fetch. Production calls pass
 *  no deps and use the real loaders. */
export interface GorgiasCommDeps {
  loadCredentials?: (shopId: string) => Promise<GorgiasCredentials | null>;
  createClient?: (creds: GorgiasCredentials) => GorgiasClient;
}

interface SnapshotMessage {
  fromAgent: boolean;
  channel: string | null;
  text: string;
  sentAt: string | null;
}

interface SnapshotConversation {
  ticketId: number;
  status: string | null;
  channel: string | null;
  csatScore: number | null;
  messages: SnapshotMessage[];
}

async function loadGorgiasCredentials(
  shopId: string,
): Promise<GorgiasCredentials | null> {
  const sb = getServiceClient();
  const { data: integration } = await sb
    .from("integrations")
    .select("id, status")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .maybeSingle();

  if (!integration || integration.status !== "connected") return null;

  const { data: secret } = await sb
    .from("integration_secrets")
    .select("secret_enc")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (!secret?.secret_enc) return null;

  const parsed = JSON.parse(
    decrypt(deserializeEncrypted(secret.secret_enc)),
  ) as Partial<GorgiasCredentials>;

  if (!parsed.subdomain || !parsed.email || !parsed.apiKey) return null;
  return {
    subdomain: parsed.subdomain,
    email: parsed.email,
    apiKey: parsed.apiKey,
  };
}

/** Drop internal agent notes and any non-public message. */
function isPublicMessage(m: GorgiasMessage): boolean {
  return m.public === true && m.channel !== "internal-note";
}

function snapshot(m: GorgiasMessage): SnapshotMessage {
  const text = (m.stripped_text ?? m.body_text ?? "").trim();
  return {
    fromAgent: m.from_agent === true,
    channel: m.channel ?? null,
    text,
    sentAt: m.sent_datetime ?? m.created_datetime ?? null,
  };
}

export async function collectGorgiasCommEvidence(
  ctx: BuildContext,
  deps: GorgiasCommDeps = {},
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  const email = order?.email?.trim() || null;
  if (!order || !email) return [];

  try {
    const loadCreds = deps.loadCredentials ?? loadGorgiasCredentials;
    const creds = await loadCreds(ctx.shopId);
    if (!creds) return [];

    const client = (deps.createClient ?? ((c) => createGorgiasClient(c)))(creds);

    const customer = await client.resolveCustomerByEmail(email);
    if (!customer) return [];

    const tickets = await client.listCustomerTickets(customer.id);
    const usable = tickets.filter((t) => !t.trashed_datetime && t.spam !== true);

    const conversations: SnapshotConversation[] = [];
    let totalMessages = 0;
    let customerMessageCount = 0;
    let highestCsat: number | null = null;

    for (const t of usable) {
      const raw = Array.isArray(t.messages)
        ? t.messages
        : await client.listTicketMessages(t.id);

      const visible = raw
        .filter(isPublicMessage)
        .map(snapshot)
        .filter((s) => s.text.length > 0);

      if (visible.length === 0) continue;

      totalMessages += visible.length;
      customerMessageCount += visible.filter((s) => !s.fromAgent).length;

      const score = t.satisfaction_survey?.score;
      if (typeof score === "number") {
        highestCsat = highestCsat === null ? score : Math.max(highestCsat, score);
      }

      conversations.push({
        ticketId: t.id,
        status: t.status ?? null,
        channel: t.channel ?? null,
        csatScore: typeof score === "number" ? score : null,
        messages: visible,
      });
    }

    if (conversations.length === 0) return [];

    return [
      {
        type: "comms",
        labelToken: { key: "packs.section.gorgiasCommunication" },
        source: "gorgias",
        fieldsProvided: ["customer_communication"],
        data: {
          provider: "gorgias",
          customerEmail: email,
          conversationCount: conversations.length,
          conversations,
          summary: {
            conversationCount: conversations.length,
            messageCount: totalMessages,
            customerMessageCount,
            highestCsatScore: highestCsat,
          },
          // customerConfirmsOrder intentionally NOT set in Phase 1 — the
          // field stays `supporting`. Auto-detecting explicit admissions
          // is a deliberate future step, not keyword-guessed here.
        },
      },
    ];
  } catch (e) {
    console.warn(
      `[gorgiasCommSource] skipped for shop ${ctx.shopId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}
