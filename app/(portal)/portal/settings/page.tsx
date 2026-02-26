"use client";

import { useTranslations } from "next-intl";
import { Shield, Globe, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

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
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
        <p className="text-sm text-[#667085]">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">{t("profileSection")}</h3>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-[#1D4ED8] rounded-full flex items-center justify-center text-white text-xl font-bold">
                JD
              </div>
              <div>
                <p className="font-medium text-[#0B1220]">John Doe</p>
                <p className="text-sm text-[#667085]">john@example.com</p>
                <button className="text-sm text-[#4F46E5] hover:underline mt-1" title={tc("demoOnly")}>{t("changeAvatar")}</button>
              </div>
            </div>
            <div className="space-y-4 max-w-md">
              <TextField label={t("fullName")} placeholder={t("namePlaceholder")} defaultValue="John Doe" />
              <TextField label={t("email")} type="email" placeholder={t("emailPlaceholder")} defaultValue="john@example.com" disabled />
              <TextField label={t("company")} placeholder={t("companyPlaceholder")} defaultValue="Acme Inc." />
              <Button variant="primary" size="sm" title={tc("demoOnly")}>{t("saveChanges")}</Button>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">{t("notificationsSection")}</h3>
            <div className="space-y-3">
              <Toggle label={t("newDisputeAlerts")} desc={t("newDisputeAlertsDesc")} defaultChecked />
              <Toggle label={t("deadlineReminders")} desc={t("deadlineRemindersDesc")} defaultChecked />
              <Toggle label={t("weeklyReport")} desc={t("weeklyReportDesc")} defaultChecked />
              <Toggle label={t("packCompletion")} desc={t("packCompletionDesc")} defaultChecked />
              <Toggle label={t("autoSaveConfirmations")} desc={t("autoSaveConfirmationsDesc")} />
            </div>
          </div>

          {/* Security */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-[#4F46E5]" />
              <h3 className="font-semibold text-[#0B1220]">{t("securitySection")}</h3>
            </div>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">{t("currentPassword")}</label>
                <input type="password" placeholder={t("currentPasswordPlaceholder")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">{t("newPassword")}</label>
                <input type="password" placeholder={t("newPasswordPlaceholder")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
              </div>
              <Button variant="primary" size="sm" title={tc("demoOnly")}>{t("updatePassword")}</Button>
            </div>

            <hr className="my-6 border-[#E5E7EB]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#0B1220]">{t("twoFactor")}</p>
                <p className="text-xs text-[#667085]">{t("twoFactorDesc")}</p>
              </div>
              <Button variant="secondary" size="sm" title={tc("demoOnly")}>{t("enable2fa")}</Button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-white rounded-lg border border-[#EF4444] p-6">
            <h3 className="font-semibold text-[#991B1B] mb-2">{t("dangerZone")}</h3>
            <p className="text-sm text-[#667085] mb-4">{t("deleteWarning")}</p>
            <Button variant="danger" size="sm" title={tc("demoOnly")}>{t("deleteAccount")}</Button>
          </div>
        </div>

        {/* Sidebar column */}
        <div className="space-y-6">
          {/* Account Info */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">{t("accountInfo")}</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#667085]">{t("plan")}</dt>
                <dd className="font-medium text-[#0B1220]">{t("professional")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#667085]">{t("memberSince")}</dt>
                <dd className="font-medium text-[#0B1220]">{t("memberSinceValue")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#667085]">{t("storesConnected")}</dt>
                <dd className="font-medium text-[#0B1220]">0</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#667085]">{t("teamMembers")}</dt>
                <dd className="font-medium text-[#0B1220]">4</dd>
              </div>
            </dl>
          </div>

          {/* Preferences */}
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h3 className="font-semibold text-[#0B1220] mb-4">{t("preferences")}</h3>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#667085] mb-1">
                  <Globe className="w-4 h-4" />
                  {t("language")}
                </label>
                <select className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5] bg-white">
                  <option value="en">English</option>
                  <option value="sv">Svenska</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#667085] mb-1">
                  <Clock className="w-4 h-4" />
                  {t("timezone")}
                </label>
                <select className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5] bg-white">
                  <option>UTC (GMT+0)</option>
                  <option>EST (GMT-5)</option>
                  <option>CET (GMT+1)</option>
                  <option>PST (GMT-8)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
