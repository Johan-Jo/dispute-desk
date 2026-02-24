import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeDesk",
  description: "Shopify chargeback evidence governance",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
