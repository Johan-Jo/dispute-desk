/**
 * Escape a value for interpolation into email HTML. Store names come from
 * the merchant ("Salt & Stone", "<3 Candles") and, unlike the myshopify
 * domain they replaced, are not HTML-safe. Use at HTML positions only —
 * plain-text bodies and subjects take the raw value.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
