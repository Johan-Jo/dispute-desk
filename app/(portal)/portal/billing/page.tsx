import { CreditCard, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function BillingPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Billing</h1>
        <p className="text-sm text-[#667085]">Manage your subscription and payment</p>
      </div>

      {/* Current plan */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-[#0B1220]">Current Plan</h3>
            <p className="text-sm text-[#667085]">Manage your subscription</p>
          </div>
          <Badge variant="primary">Free Plan</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[#667085]">Disputes/month</p>
            <p className="font-medium text-[#0B1220]">3 / 10</p>
          </div>
          <div>
            <p className="text-[#667085]">Evidence packs</p>
            <p className="font-medium text-[#0B1220]">2 / 5</p>
          </div>
          <div>
            <p className="text-[#667085]">Billing cycle</p>
            <p className="font-medium text-[#0B1220]">Monthly</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[#E5E7EB]">
          <Button variant="primary" size="sm">Upgrade plan</Button>
        </div>
      </div>

      {/* Plan comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="font-semibold text-[#0B1220] mb-1">Free</h3>
          <p className="text-2xl font-bold text-[#0B1220] mb-4">$0<span className="text-sm font-normal text-[#667085]">/mo</span></p>
          <ul className="space-y-2 text-sm text-[#667085]">
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />10 disputes/month</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />5 evidence packs</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />Email support</li>
          </ul>
        </div>
        <div className="bg-[#1D4ED8] text-white rounded-lg p-6 relative">
          <div className="absolute top-3 right-3 bg-white text-[#1D4ED8] text-xs font-semibold px-2 py-1 rounded">Current</div>
          <h3 className="font-semibold mb-1">Starter</h3>
          <p className="text-2xl font-bold mb-4">$49<span className="text-sm font-normal opacity-80">/mo</span></p>
          <ul className="space-y-2 text-sm opacity-90">
            <li className="flex items-center gap-2"><Check className="w-4 h-4" />50 disputes/month</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4" />20 evidence packs</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4" />Priority support</li>
          </ul>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="font-semibold text-[#0B1220] mb-1">Pro</h3>
          <p className="text-2xl font-bold text-[#0B1220] mb-4">$99<span className="text-sm font-normal text-[#667085]">/mo</span></p>
          <ul className="space-y-2 text-sm text-[#667085]">
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />Unlimited disputes</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />Unlimited packs</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E]" />Advanced automation</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
