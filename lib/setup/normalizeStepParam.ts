/**
 * Shopify Admin / manual edits sometimes produce `/app/setup/rules&dd_debug=1` (ampersand in the **path**).
 * Next then passes `step` = `rules&dd_debug=1`, which is not a valid StepId.
 */
export function normalizeSetupStepParam(raw: string | string[] | undefined): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return "";
  try {
    const decoded = decodeURIComponent(s);
    return decoded.split("&")[0].split("?")[0].trim();
  } catch {
    return String(s).split("&")[0].split("?")[0].trim();
  }
}
