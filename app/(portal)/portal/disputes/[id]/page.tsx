import { ArrowLeft, Clock, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DisputeDetailPage({ params }: Props) {
  const { id } = await params;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6">
        <a href="/portal/disputes" className="inline-flex items-center gap-1 text-sm text-[#4F46E5] hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" />
          Back to Disputes
        </a>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1220]">Dispute {id}</h1>
            <p className="text-sm text-[#667085]">Order #1042 &middot; john@example.com</p>
          </div>
          <Badge variant="warning">Needs Response</Badge>
        </div>
      </div>

      {/* Deadline banner */}
      <InfoBanner variant="warning" title="Response deadline approaching">
        You have 5 days to submit evidence. Deadline: March 02, 2026
      </InfoBanner>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dispute summary card */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">Dispute Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[#667085]">Reason</p>
                <p className="font-medium text-[#0B1220]">Product not received</p>
              </div>
              <div>
                <p className="text-[#667085]">Amount</p>
                <p className="font-medium text-[#0B1220]">$145.00</p>
              </div>
              <div>
                <p className="text-[#667085]">Filed on</p>
                <p className="font-medium text-[#0B1220]">Feb 20, 2026</p>
              </div>
              <div>
                <p className="text-[#667085]">Network</p>
                <p className="font-medium text-[#0B1220]">Visa</p>
              </div>
            </div>
          </div>

          {/* Evidence pack */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#0B1220]">Evidence Pack</h3>
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
            <div className="mt-4 flex gap-3">
              <Button variant="primary" size="sm">Generate Pack</Button>
              <Button variant="secondary" size="sm">Upload File</Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">Timeline</h3>
            <div className="space-y-4">
              {[
                { date: "Feb 24", text: "Evidence pack generated" },
                { date: "Feb 22", text: "Dispute synced from Shopify" },
                { date: "Feb 20", text: "Chargeback filed by customer" },
              ].map((e, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 bg-[#4F46E5] rounded-full mt-2" />
                    {i < 2 && <div className="w-0.5 flex-1 bg-[#E5E7EB]" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-xs text-[#667085]">{e.date}</p>
                    <p className="text-sm text-[#0B1220]">{e.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
