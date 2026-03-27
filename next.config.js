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
  outputFileTracingIncludes: {
    // Bundle the markdown template files with the serverless function
    "/api/policy-templates/[type]/content": ["./content/policy-templates/**/*.md"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  },
  // Header rule order: when multiple rules match, the LAST one wins. So put allow-framing (embedded) rules LAST.
  headers: async () => [
    {
      // Default: deny framing via CSP only (no X-Frame-Options so embedded allow rules are not blocked)
      source: "/((?!app/).*)",
      headers: [
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
    {
      // Root: allow framing (Shopify iframe). MUST come after deny so it wins for path "/".
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
      // Resources Hub (default locale, unprefixed): same CSP as marketing.
      source: "/(resources|templates|case-studies|glossary|blog)/:path*",
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
      // Locale-prefixed marketing paths: same CSP as "/" (Shopify may load application_url in iframe).
      source: "/:locale(de|es|fr|pt|sv)/:path*",
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
      // Auth route in iframe: allow framing + App Bridge so breakout redirect works. MUST come after deny.
      source: "/api/auth/shopify",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com",
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            "img-src 'self' data: https://cdn.shopify.com",
            "connect-src 'self' https://*.myshopify.com wss://*.shopifycloud.com",
            "font-src 'self' https://cdn.shopify.com",
          ].join("; "),
        },
      ],
    },
    {
      // Embedded app: allow framing. MUST come last so it wins for /app and /app/*.
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
  ],
};

module.exports = withNextIntl(nextConfig);
