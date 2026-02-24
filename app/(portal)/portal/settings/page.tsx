"use client";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { InfoBanner } from "@/components/ui/info-banner";

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Settings</h1>
        <p className="text-sm text-[#667085]">Manage your account and preferences</p>
      </div>

      <div className="space-y-6">
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
            {[
              { label: "New dispute alerts", desc: "Get notified when new chargebacks appear" },
              { label: "Deadline reminders", desc: "Reminder emails before response deadlines" },
              { label: "Pack completion", desc: "Notified when evidence packs finish generating" },
            ].map((n) => (
              <div key={n.label} className="flex items-center justify-between p-3 bg-[#F7F8FA] rounded-lg">
                <div>
                  <p className="text-sm font-medium text-[#0B1220]">{n.label}</p>
                  <p className="text-xs text-[#667085]">{n.desc}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#1D4ED8] rounded-full peer-focus:ring-2 peer-focus:ring-[#1D4ED8] peer-focus:ring-offset-2 after:content-[''] after:absolute after:top-0.5 after:left-[2px] peer-checked:after:translate-x-full after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all" />
                </label>
              </div>
            ))}
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
