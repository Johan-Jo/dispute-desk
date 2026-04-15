const path = require("path");
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** GA4 (gtag.js): allow loader + measurement endpoints (see Google Tag CSP guide). */
const GA_SCRIPT_SRC = "https://www.googletagmanager.com";
const GA_CONNECT_SRC = [
  "https://www.google-analytics.com",
  "https://analytics.google.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.googletagmanager.com",
].join(" ");

/** tawk.to live chat: script loader, API/websocket, widget iframe, and static assets. */
const TAWK_SCRIPT_SRC = "https://embed.tawk.to";
const TAWK_CONNECT_SRC = "https://*.tawk.to wss://*.tawk.to";
const TAWK_FRAME_SRC = "https://tawk.to https://*.tawk.to";
const TAWK_IMG_SRC = "https://*.tawk.to";
const TAWK_FONT_SRC = "https://*.tawk.to";

/** Cal.com embed: script loader, booking iframe, and API. */
const CAL_SCRIPT_SRC = "https://app.cal.com";
const CAL_FRAME_SRC = "https://app.cal.com";
const CAL_CONNECT_SRC = "https://app.cal.com";

/** Hub hero / cards: Supabase Storage + common stock CDNs (next/image remotePatterns). */
const IMG_SRC_HUB =
  "img-src 'self' data: https://cdn.shopify.com https://*.supabase.co https://images.pexels.com https://images.unsplash.com";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/**" },
      { protocol: "https", hostname: "images.pexels.com", pathname: "/**" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
  },
  async redirects() {
    return [
      // Bookmarks / misconfigured dashboards may use /sign-in; app lives at /auth/sign-in
      { source: "/sign-in", destination: "/auth/sign-in", permanent: true },
    ];
  },
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
      source: "/((?!app/|api/chat).*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors 'none'",
            "default-src 'self'",
            `frame-src 'self' https://vercel.live ${TAWK_FRAME_SRC} ${CAL_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC} ${CAL_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline'",
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC}`,
            `connect-src 'self' https://*.supabase.co ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC} ${CAL_CONNECT_SRC}`,
            `font-src 'self' ${TAWK_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC}`,
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
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            "img-src 'self' data: https://cdn.shopify.com",
            `connect-src 'self' https://*.myshopify.com wss://*.shopifycloud.com ${GA_CONNECT_SRC}`,
            "font-src 'self' https://cdn.shopify.com",
          ].join("; "),
        },
      ],
    },
    {
      // Chat proxy page: loaded in iframe inside embedded app; needs Tawk.to CSP + framing.
      source: "/api/chat",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com https://disputedesk.app",
            "default-src 'self'",
            `frame-src 'self' ${TAWK_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${TAWK_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline'",
            `img-src 'self' data: ${TAWK_IMG_SRC}`,
            `connect-src 'self' ${TAWK_CONNECT_SRC}`,
            `font-src 'self' ${TAWK_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC}`,
            "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC}`,
          ].join("; "),
        },
      ],
    },
  ],
};

module.exports = withNextIntl(nextConfig);
