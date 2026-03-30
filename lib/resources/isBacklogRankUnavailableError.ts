/**
 * Detect PostgREST/Postgres errors caused by `content_archive_items.backlog_rank`
 * not existing yet (migration `20260330180000_content_archive_backlog_rank.sql` not applied).
 */
export function isBacklogRankUnavailableError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  const m = (error?.message ?? "").toLowerCase();
  const code = (error?.code ?? "").toLowerCase();
  if (!m.includes("backlog_rank")) return false;
  return (
    code === "42703" ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("undefined column")
  );
}
