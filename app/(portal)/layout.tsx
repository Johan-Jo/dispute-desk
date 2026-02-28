import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import { PortalShell } from "./portal-shell";
import { getServiceClient } from "@/lib/supabase/server";
import { NextIntlClientProvider } from "next-intl";
import { resolveLocale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/getMessages";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const sb = getServiceClient();
  const { data: shops } = await sb
    .from("portal_user_shops")
    .select("shop_id, role, shops(shop_domain, locale)")
    .eq("user_id", user.id);

  const activeShopId =
    cookieStore.get("dd_active_shop")?.value ??
    cookieStore.get("active_shop_id")?.value ??
    null;
  const activeShop = shops?.find(
    (s: { shop_id: string }) => s.shop_id === activeShopId
  );
  const shopData = activeShop?.shops as unknown as {
    shop_domain: string;
    locale: string | null;
  } | null;
  const activeShopDomain = shopData?.shop_domain ?? null;
  const shopLocale = shopData?.locale ?? null;

  const cookieLocale = cookieStore.get("dd_locale")?.value ?? null;
  const headerStore = await headers();
  const acceptLang = headerStore.get("accept-language");

  const locale = resolveLocale({
    userLocale: cookieLocale,
    shopLocale,
    shopifyLocale: acceptLang?.split(",")[0]?.split(";")[0]?.trim(),
  });
  const messages = await getMessages(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <PortalShell
        userEmail={user.email ?? ""}
        shops={shops ?? []}
        activeShopId={activeShopId}
        activeShopDomain={activeShopDomain}
      >
        {children}
      </PortalShell>
    </NextIntlClientProvider>
  );
}
