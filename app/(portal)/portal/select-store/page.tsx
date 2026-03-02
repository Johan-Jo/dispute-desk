import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Store, Check } from "lucide-react";
import { requirePortalUser } from "@/lib/supabase/portal";
import {
  getLinkedShops,
  setActiveShopId,
  clearActiveShopId,
} from "@/lib/portal/activeShop";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  searchParams: Promise<{ shop_id?: string }>;
}

export default async function SelectStorePage({ searchParams }: Props) {
  const user = await requirePortalUser();
  const shops = await getLinkedShops(user.id);
  const params = await searchParams;
  const t = await getTranslations("selectStore");

  if (params.shop_id === "demo") {
    await clearActiveShopId();
    redirect("/portal/dashboard");
  }

  if (params.shop_id) {
    const valid = shops.some((s) => s.shop_id === params.shop_id);
    if (valid) {
      await setActiveShopId(params.shop_id);
      redirect("/portal/dashboard");
    }
  }

  if (shops.length === 0) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <div className="w-16 h-16 bg-[#F7F8FA] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Store className="w-8 h-8 text-[#667085]" />
        </div>
        <h2 className="text-2xl font-bold text-[#0B1220] mb-2">{t("noStores")}</h2>
        <p className="text-sm text-[#667085] mb-6">
          {t("noStoresDesc")}
        </p>
        <a href="/portal/connect-shopify">
          <Button variant="primary" size="lg">{t("connectStore")}</Button>
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[#0B1220] mb-2">{t("title")}</h2>
        <p className="text-sm text-[#667085]">{t("subtitle")}</p>
      </div>

      <div className="space-y-3 mb-6">
        {shops.map((s) => {
          const domain =
            (s.shops as unknown as { shop_domain: string })?.shop_domain ??
            s.shop_id;
          return (
            <a
              key={s.shop_id}
              href={`/portal/select-store?shop_id=${s.shop_id}`}
              className="w-full block p-4 border border-[#E5E7EB] rounded-lg hover:border-[#4F46E5] hover:bg-[#F7F8FA] transition-colors bg-white"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#F7F8FA] rounded-lg flex items-center justify-center">
                    <Store className="w-6 h-6 text-[#667085]" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#0B1220] mb-1">{domain}</h4>
                    <p className="text-sm text-[#667085]">{s.role}</p>
                  </div>
                </div>
                <Badge variant="success">
                  <Check className="w-3 h-3 mr-1" />
                  {t("connected")}
                </Badge>
              </div>
            </a>
          );
        })}
      </div>

      {/* Demo Store option */}
      <a
        href="/portal/select-store?shop_id=demo"
        className="block p-4 border border-[#FDE68A] bg-[#FFFBEB] rounded-lg hover:bg-[#FEF3C7] transition-colors mb-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
              <Store className="w-6 h-6 text-[#D97706]" />
            </div>
            <div>
              <h4 className="font-semibold text-[#0B1220] mb-1">
                {t("demoStore")}
              </h4>
              <p className="text-sm text-[#92400E]">demo.myshopify.com</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider bg-[#F59E0B] text-white px-2 py-1 rounded">
            Demo
          </span>
        </div>
      </a>

      <a href="/portal/connect-shopify">
        <Button variant="secondary" className="w-full">{t("connectAnother")}</Button>
      </a>
    </div>
  );
}
