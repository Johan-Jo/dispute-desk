import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  params: Promise<{ packId: string }>;
}

export default async function PackDetailPage({ params }: Props) {
  const { packId } = await params;

  return (
    <div>
      <a href="/portal/packs" className="inline-flex items-center gap-1 text-sm text-[#4F46E5] hover:underline mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Packs
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Pack {packId}</h1>
          <p className="text-sm text-[#667085]">Evidence package details</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" size="sm">Download PDF</Button>
          <Button variant="primary" size="sm">Save to Shopify</Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#0B1220]">Evidence Items</h3>
          <Badge variant="primary">67% complete</Badge>
        </div>
        <div className="space-y-3">
          {[
            { label: "Order Confirmation", done: true },
            { label: "Shipping Tracking", done: true },
            { label: "Delivery Proof", done: false },
            { label: "Customer Communication", done: false },
            { label: "Refund / Return Policy", done: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between p-3 bg-[#F7F8FA] rounded-lg">
              <span className="text-sm text-[#0B1220]">{item.label}</span>
              {item.done ? (
                <Badge variant="success">Collected</Badge>
              ) : (
                <Badge variant="warning">Missing</Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
