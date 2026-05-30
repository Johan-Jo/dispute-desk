import DisputesListPage from "@/app/(embedded)/app/disputes/page";

/**
 * Mirrors the real embedded disputes list. The fetch shim handles
 * /api/disputes, /api/disputes/sync, and /api/shop/preferences with
 * fixture data so this renders identically to production.
 */
export const dynamic = "force-static";

export default function DemoDisputesListPage() {
  return <DisputesListPage />;
}
