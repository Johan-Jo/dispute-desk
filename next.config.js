const path = require("path");
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/favicon.svg" }];
  },
  // Use separate build dir when started by Playwright E2E to avoid .next/trace EPERM lock
  distDir: process.env.NEXT_E2E_BUILD ? ".next-e2e" : ".next",
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  },
  headers: async () => [
    {
      // Embedded app routes: allow Shopify Admin to iframe
      source: "/app/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com",
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            "img-src 'self' data: https://cdn.shopify.com https://*.supabase.co",
            "connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com",
            "font-src 'self' https://cdn.shopify.com",
          ].join("; "),
        },
      ],
    },
    {
      // Root: allow framing so Shopify can load app (iframe); middleware redirects ?shop= to /app
      source: "/",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com",
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            "img-src 'self' data: https://cdn.shopify.com https://*.supabase.co",
            "connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com",
            "font-src 'self' https://cdn.shopify.com",
          ].join("; "),
        },
      ],
    },
    {
      // Marketing, portal, auth: deny framing (not embedded)
      source: "/((?!app/).*)",
      headers: [
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors 'none'",
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://*.supabase.co",
            "connect-src 'self' https://*.supabase.co",
            "font-src 'self'",
          ].join("; "),
        },
      ],
    },
  ],
};

module.exports = withNextIntl(nextConfig);
