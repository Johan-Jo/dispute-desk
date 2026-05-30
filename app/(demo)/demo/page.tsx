import EmbeddedDashboardPage from "@/app/(embedded)/app/page";

/**
 * Demo dashboard — re-uses the real embedded dashboard page component
 * directly. The fetch shim (installed in the demo layout) intercepts
 * /api/setup/state and /api/dashboard/stats calls and returns fixture
 * JSON, so the same component renders identically to production but with
 * pre-baked numbers.
 *
 * This is the canonical pattern for mirroring an embedded page: import
 * the page's default export and let the fetch shim handle data. Do NOT
 * fork the page body.
 */
export const dynamic = "force-static";

export default function DemoDashboardPage() {
  return <EmbeddedDashboardPage />;
}
