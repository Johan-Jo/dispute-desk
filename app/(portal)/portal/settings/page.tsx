"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { InfoBanner } from "@/components/ui/info-banner";

function Toggle({ label, desc, defaultChecked = false }: { label: string; desc: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 bg-[#F7F8FA] rounded-lg">
      <div>
        <p className="text-sm font-medium text-[#0B1220]">{label}</p>
        <p className="text-xs text-[#667085]">{desc}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" defaultChecked={defaultChecked} className="sr-only peer" />
        <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#1D4ED8] rounded-full peer-focus:ring-2 peer-focus:ring-[#1D4ED8] peer-focus:ring-offset-2 after:content-[''] after:absolute after:top-0.5 after:left-[2px] peer-checked:after:translate-x-full after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all" />
      </label>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Settings</h1>
        <p className="text-sm text-[#667085]">Manage your account, automation, and preferences</p>
      </div>

      <div className="space-y-6">
        {/* Automation settings */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-[#4F46E5]" />
            <h3 className="font-semibold text-[#0B1220]">Automation</h3>
          </div>

          <InfoBanner variant="info">
            Evidence is saved to Shopify via API. Submission to the card
            network happens in Shopify Admin (or auto-submits on due date).
            DisputeDesk does not submit on your behalf.
          </InfoBanner>

          <div className="space-y-3 mt-4">
            <Toggle
              label="Auto-build evidence packs"
              desc="Automatically generate packs when new disputes are detected"
              defaultChecked
            />
            <Toggle
              label="Auto-save evidence to Shopify"
              desc="Automatically push complete evidence to Shopify when gates pass"
              defaultChecked
            />
            <Toggle
              label="Require review before auto-save"
              desc="Park packs in review queue for approval before saving to Shopify"
              defaultChecked
            />
            <Toggle
              label="Enforce zero blockers"
              desc="Block auto-save if any required evidence items are missing"
              defaultChecked
            />
          </div>

          <div className="mt-4 max-w-xs">
            <TextField
              label="Minimum completeness score for auto-save"
              type="number"
              placeholder="80"
              defaultValue="80"
              helperText="Packs below this score won't be auto-saved (0–100)"
            />
          </div>

          <div className="mt-4">
            <Button variant="primary" size="sm">Save automation settings</Button>
          </div>
        </div>

        {/* Profile */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">Profile</h3>
          <div className="space-y-4 max-w-md">
            <TextField label="Full Name" placeholder="John Doe" />
            <TextField label="Email" type="email" placeholder="you@company.com" disabled />
            <Button variant="primary" size="sm">Save changes</Button>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">Notifications</h3>
          <div className="space-y-3">
            <Toggle label="New dispute alerts" desc="Get notified when new chargebacks appear" defaultChecked />
            <Toggle label="Deadline reminders" desc="Reminder emails before response deadlines" defaultChecked />
            <Toggle label="Pack completion" desc="Notified when evidence packs finish generating" defaultChecked />
            <Toggle label="Auto-save confirmations" desc="Notified when evidence is auto-saved to Shopify" defaultChecked />
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-white rounded-lg border border-[#EF4444] p-6">
          <h3 className="font-semibold text-[#991B1B] mb-2">Danger Zone</h3>
          <p className="text-sm text-[#667085] mb-4">Once deleted, your account and all data cannot be recovered.</p>
          <Button variant="danger" size="sm">Delete account</Button>
        </div>
      </div>
    </div>
  );
}
