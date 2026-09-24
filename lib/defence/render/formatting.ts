/**
 * Bank-document formatting shared by the PDF and the embedded HTML view, so
 * both print the same string for the same value.
 */

/**
 * "USD 129" → "USD 129.00", "USD 40.0" → "USD 40.00". A value that is not a
 * plain currency-code amount is returned unchanged — never guessed at.
 */
export function formatMoneyDisplay(value: string | null | undefined): string | null {
  if (value == null) return null;
  const m = value.trim().match(/^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/);
  if (!m) return value;
  const n = Number(m[2]);
  return Number.isFinite(n) ? `${m[1]} ${n.toFixed(2)}` : value;
}

/**
 * The reason-code label for the card that was actually used.
 *
 * Reason-code modules carry both networks' codes ("Visa 13.1 / Mastercard
 * 4855") because one module answers both. On a Visa dispute the Mastercard
 * code is noise, and it makes the document look generic (blume-box #360980,
 * 2026-09-23). Keeps the segment naming `cardNetwork`; falls back to the full
 * label when the network is unknown or not named in it.
 */
export function reasonCodeForNetwork(
  display: string | null | undefined,
  cardNetwork: string | null | undefined,
): string | null {
  if (!display) return display ?? null;
  const network = cardNetwork?.trim().toLowerCase();
  if (!network) return display;
  const segments = display.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return display;
  const alias = (n: string) => (n === "master" || n === "mc" ? "mastercard" : n === "amex" ? "american express" : n);
  const wanted = alias(network);
  const match = segments.find((s) => alias(s.toLowerCase()).startsWith(wanted));
  return match ?? display;
}
