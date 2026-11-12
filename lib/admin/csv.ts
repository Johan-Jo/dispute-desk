/**
 * RFC 4180 CSV for admin exports.
 *
 * Every cell is quoted and embedded quotes are doubled, so commas, newlines and
 * JSON payloads can't shift columns (the previous audit export joined raw
 * values with commas). Cells that start with `= + - @` (or tab/CR) get a
 * leading apostrophe: spreadsheet apps execute those as formulas, and audit
 * payloads contain merchant-controlled text.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
