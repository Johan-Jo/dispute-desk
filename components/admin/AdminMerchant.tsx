import { displayShopDomain } from "@/lib/shopify/domainHost";

/**
 * The one way admin pages print a merchant: the real storefront domain on the
 * first line (e.g. `hemochtrend.se`) with the myshopify alias beneath it
 * (`whj8db-1q.myshopify.com`) — exactly as the Shops list does. The alias line
 * is omitted only when there is no distinct storefront domain.
 */
export function AdminMerchant({
  shopDomain,
  primaryDomain,
  className = "",
}: {
  shopDomain: string;
  primaryDomain?: string | null;
  className?: string;
}) {
  const display = displayShopDomain({ shop_domain: shopDomain, primary_domain: primaryDomain });
  return (
    <span className={`flex min-w-0 flex-col ${className}`}>
      <span className="truncate">{display}</span>
      {display !== shopDomain && (
        <span className="truncate text-xs font-normal text-[#94A3B8]">{shopDomain}</span>
      )}
    </span>
  );
}
