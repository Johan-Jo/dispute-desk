/**
 * Targeted admin→merchant in-app messages.
 *
 * An admin composes a message for one shop (see the Messages card on
 * the admin shop-detail page). Published messages render as a
 * dismissible banner on that shop's embedded dashboard, optionally
 * with an email/phone form whose submission is mailed to ops.
 *
 * These strings are intentionally free text rather than I18nToken:
 * they are one-off, human-authored notes to a specific merchant,
 * written in whatever language that merchant speaks. No library code
 * derives them and nothing persists them into pack data, so the
 * structural-i18n rule (CLAUDE.md #5) doesn't apply.
 */

export type MerchantMessageTone = "info" | "success" | "warning" | "critical";
export type MerchantMessageStatus = "draft" | "published" | "archived";

export interface MerchantMessage {
  id: string;
  shopId: string;
  title: string;
  body: string;
  askForContact: boolean;
  tone: MerchantMessageTone;
  status: MerchantMessageStatus;
  expiresAt: string | null;
  dismissedAt: string | null;
  respondedAt: string | null;
  responseEmail: string | null;
  responsePhone: string | null;
  responseNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The subset the merchant-facing dashboard needs. */
export interface ActiveMerchantMessage {
  id: string;
  title: string;
  body: string;
  askForContact: boolean;
  tone: MerchantMessageTone;
}

export function mapMerchantMessageRow(row: Record<string, unknown>): MerchantMessage {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const nullable = (v: unknown): string | null =>
    typeof v === "string" ? v : null;

  return {
    id: str(row.id),
    shopId: str(row.shop_id),
    title: str(row.title),
    body: str(row.body),
    askForContact: row.ask_for_contact !== false,
    tone: str(row.tone) as MerchantMessageTone,
    status: str(row.status) as MerchantMessageStatus,
    expiresAt: nullable(row.expires_at),
    dismissedAt: nullable(row.dismissed_at),
    respondedAt: nullable(row.responded_at),
    responseEmail: nullable(row.response_email),
    responsePhone: nullable(row.response_phone),
    responseNote: nullable(row.response_note),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}
