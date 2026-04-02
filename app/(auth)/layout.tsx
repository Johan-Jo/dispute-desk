import { cookies, headers } from "next/headers";
import { Shield } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const acceptLang = headerStore.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim();

  const locale = resolveLocale({
    userLocale: cookieLocale,
    shopifyLocale: acceptLang,
  });

  let messages = await getMessages(locale);
  if (!messages || typeof messages !== "object") {
    messages = (await import("@/messages/en-US.json")).default;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 bg-[#4F46E5] rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-[#0B1220]">DisputeDesk</h1>
          </div>
          {children}
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
