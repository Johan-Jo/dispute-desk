import { Providers } from "./providers";

export default function EmbeddedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
      <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      <Providers>{children}</Providers>
    </>
  );
}
