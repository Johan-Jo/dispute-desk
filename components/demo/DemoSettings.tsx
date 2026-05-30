"use client";

import { useDemoToast } from "./DemoToast";

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 flex items-start justify-between gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#0B1220]">{title}</div>
        <div className="text-xs text-[#6B7280] mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  const { show } = useDemoToast();
  return (
    <button
      type="button"
      onClick={() => show("This is a demo — install DisputeDesk to change settings.")}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${on ? "bg-[#1D4ED8]" : "bg-[#D1D5DB]"}`}
      aria-pressed={on}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export function DemoSettings() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0B1220]">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">Automation, alerts, and workspace preferences.</p>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#0B1220]">Automation mode</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">Choose how DisputeDesk handles new disputes.</p>
        </div>
        <div className="divide-y divide-[#F1F2F4]">
          <SettingRow
            title="Auto-submit Strong cases"
            description="DisputeDesk saves the defence pack to Shopify automatically when a case scores ≥ 80%. Weak cases always park for review."
            control={<Toggle on={true} />}
          />
          <SettingRow
            title="Review mode (default)"
            description="Every pack waits for your approval before saving to Shopify, regardless of strength."
            control={<Toggle on={false} />}
          />
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#0B1220]">Alerts</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">Email notifications for dispute events.</p>
        </div>
        <div className="divide-y divide-[#F1F2F4]">
          <SettingRow
            title="Alert email"
            description="Where DisputeDesk sends summary digests and urgent notifications."
            control={
              <input
                type="text"
                readOnly
                value="ops@your-store.com"
                className="h-8 px-2.5 text-sm rounded-md border border-[#E5E7EB] bg-[#F9FAFB] w-56 text-[#0B1220]"
              />
            }
          />
          <SettingRow
            title="Notify when a case parks for review"
            description="Get an email within minutes when DisputeDesk needs merchant input on a case."
            control={<Toggle on={true} />}
          />
          <SettingRow
            title="Daily digest"
            description="Morning summary of overnight dispute activity."
            control={<Toggle on={true} />}
          />
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#0B1220]">Coverage and safety gates</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">Built-in protections to keep automation from working against you.</p>
        </div>
        <div className="divide-y divide-[#F1F2F4]">
          <SettingRow
            title="Respect Shopify Protect coverage"
            description="When Shopify is already covering a dispute, DisputeDesk skips pack-building entirely. Cannot be disabled."
            control={<Toggle on={true} />}
          />
          <SettingRow
            title="Fatal-loss gate"
            description="If you've already refunded the customer, DisputeDesk blocks submission — confessing the refund to the bank would lose the case."
            control={<Toggle on={true} />}
          />
        </div>
      </div>
    </div>
  );
}
