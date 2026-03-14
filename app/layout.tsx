import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeDesk",
  description: "Shopify chargeback evidence governance",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // App Bridge must be a synchronous blocking script (no defer/async/type=module)
  // and must be first. React hoists <script src> from nested components and adds
  // async/defer — the only safe place is the explicit <head> in the root layout.
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return (
    <html lang="en">
      <head>
        {apiKey && (
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={apiKey}
          />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
