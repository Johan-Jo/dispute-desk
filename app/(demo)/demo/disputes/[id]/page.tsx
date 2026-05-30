import { notFound } from "next/navigation";
import { DEMO_DISPUTES, getDemoDispute } from "@/lib/demo/fixtures/disputes";
import { DemoDisputeDetail } from "@/components/demo/DemoDisputeDetail";

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
  const dispute = getDemoDispute(id);
  if (!dispute) notFound();
  return <DemoDisputeDetail dispute={dispute} isHero={dispute.id === "dp-2401"} />;
}
