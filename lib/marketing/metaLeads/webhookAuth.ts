import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's `X-Hub-Signature-256` header: `sha256=<hex HMAC of the raw body, keyed by the app secret>`.
 * Must be computed over the exact raw bytes Meta sent, so callers pass `await req.text()`.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [scheme, hex] = header.split("=");
  if (scheme !== "sha256" || !hex) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(hex, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type LeadgenChange = { leadgenId: string; formId: string | null; pageId: string | null };

/** The `leadgen` notifications inside a Page webhook payload; anything else is ignored. */
export function extractLeadgenChanges(payload: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = change as { field?: string; value?: { leadgen_id?: string | number; form_id?: string | number; page_id?: string | number } };
      if (c.field !== "leadgen" || c.value?.leadgen_id == null) continue;
      out.push({
        leadgenId: String(c.value.leadgen_id),
        formId: c.value.form_id != null ? String(c.value.form_id) : null,
        pageId: c.value.page_id != null ? String(c.value.page_id) : null,
      });
    }
  }
  return out;
}
