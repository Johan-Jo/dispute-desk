import { notFound } from "next/navigation";
import { DEMO_DISPUTES } from "@/lib/demo/fixtures/disputes";
import WorkspaceShell from "@/app/(embedded)/app/disputes/[id]/WorkspaceShell";

/**
 * Demo dispute detail — mirrors the real embedded WorkspaceShell
 * (3-tab Polaris layout: Overview / Evidence / Review & Submit).
 *
 * The fetch shim intercepts /api/disputes/[id]/workspace and returns
 * a buildWorkspaceData() fixture so the same component renders with
 * stable demo data instead of a live Shopify dispute.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return DEMO_DISPUTES.map((d) => ({ id: d.id }));
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DemoDisputeDetailPage({ params }: Props) {
  const { id } = await params;
  if (!DEMO_DISPUTES.find((d) => d.id === id)) notFound();
  return <WorkspaceShell disputeId={id} />;
}
