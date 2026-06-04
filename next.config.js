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

/** YouTube hero demo (standard + nocookie player iframe + thumbnail CDN). */
const YOUTUBE_FRAME_SRC =
  "https://www.youtube.com https://www.youtube-nocookie.com";
const YOUTUBE_IMG_SRC = "https://i.ytimg.com";

/** Google Fonts: stylesheet host + font-file host (hero editorial typefaces). */
const GFONTS_STYLE_SRC = "https://fonts.googleapis.com";
const GFONTS_FONT_SRC = "https://fonts.gstatic.com";

/** Ahrefs Web Analytics: loader script + beacon endpoint (marketing surfaces only). */
const AHREFS_SCRIPT_SRC = "https://analytics.ahrefs.com";
const AHREFS_CONNECT_SRC = "https://analytics.ahrefs.com";

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
    // PDF render worker (child-process escape hatch for the two-Reacts
    // mismatch between Next.js 15's bundled React 19 and @react-pdf's
    // node_modules/react@18.3.1 — see lib/defence/renderDefencePdf.ts).
    // Both files are required at runtime: the worker entry script plus
    // the pre-bundled document. Lists every route that transitively
    // calls renderDefencePdf so the worker ships with each function.
    "/api/jobs/worker": ["./scripts/pdf-worker/**"],
    "/api/cron/debug-defence-render": ["./scripts/pdf-worker/**"],
    "/api/cron/defence-package-deadline-submit": ["./scripts/pdf-worker/**"],
    "/api/defence-packages/[id]/regenerate": ["./scripts/pdf-worker/**"],
    "/api/defence-packages/[id]/preview": ["./scripts/pdf-worker/**"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // @react-pdf/renderer + the two-Reacts problem.
  //
  // Background (2026-05-16): every defence-package PDF render in prod
  // was failing with React minified error #31 ("Objects are not valid
  // as a React child (found: object with keys {$$typeof, type, key,
  // ref, props})"). Verified via /api/cron/debug-defence-render that
  // even a hello-world <Document><Page><Text>Hi</Text></Page></Document>
  // fails — so it's a runtime/bundler problem, not a document-tree bug.
  //
  // Root cause: Next.js 15 ships its own compiled React at
  // `node_modules/next/dist/compiled/react` which uses
  // `Symbol.for("react.transitional.element")` for $$typeof (React 19's
  // transitional element shape). The project's React 18.3.1 at
  // `node_modules/react` uses `Symbol.for("react.element")`. They are
  // NOT compatible across the @react-pdf reconciler's identity check.
  //
  // Attempted fix #1 (commit 3871f28): externalize @react-pdf/renderer
  // via serverExternalPackages. Failed — moved @react-pdf to Node
  // resolution (react@18.3.1, "react.element") while renderDefencePdf
  // still used webpack-bundled next/compiled/react ("react.transitional.element").
  // Mismatch guaranteed. Reverted here.
  //
  // Attempted fix #2 (2026-05-16): also externalize "react". Failed —
  // breaks app-router page builds because Next requires its compiled
  // React for RSC. `npm run build` errored on /auth/magic-link-sent.
  //
  // No serverExternalPackages for @react-pdf at all — fix to be added
  // at the call site instead (see lib/defence/renderDefencePdf.ts).
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
            `frame-src 'self' https://vercel.live ${TAWK_FRAME_SRC} ${CAL_FRAME_SRC} ${YOUTUBE_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC} ${CAL_SCRIPT_SRC} ${AHREFS_SCRIPT_SRC}`,
            `style-src 'self' 'unsafe-inline' ${GFONTS_STYLE_SRC}`,
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC} ${YOUTUBE_IMG_SRC}`,
            `connect-src 'self' https://*.supabase.co ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC} ${CAL_CONNECT_SRC} ${AHREFS_CONNECT_SRC}`,
            `font-src 'self' ${TAWK_FONT_SRC} ${GFONTS_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC} ${YOUTUBE_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC} ${AHREFS_SCRIPT_SRC}`,
            `style-src 'self' 'unsafe-inline' https://cdn.shopify.com ${GFONTS_STYLE_SRC}`,
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC} ${YOUTUBE_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC} ${AHREFS_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC} ${GFONTS_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC} ${YOUTUBE_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC} ${AHREFS_SCRIPT_SRC}`,
            `style-src 'self' 'unsafe-inline' https://cdn.shopify.com ${GFONTS_STYLE_SRC}`,
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC} ${YOUTUBE_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC} ${AHREFS_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC} ${GFONTS_FONT_SRC}`,
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
            `frame-src 'self' ${TAWK_FRAME_SRC} ${YOUTUBE_FRAME_SRC}`,
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com ${GA_SCRIPT_SRC} ${TAWK_SCRIPT_SRC} ${AHREFS_SCRIPT_SRC}`,
            `style-src 'self' 'unsafe-inline' https://cdn.shopify.com ${GFONTS_STYLE_SRC}`,
            `${IMG_SRC_HUB} ${TAWK_IMG_SRC} ${YOUTUBE_IMG_SRC}`,
            `connect-src 'self' https://*.myshopify.com https://*.supabase.co wss://*.shopifycloud.com ${GA_CONNECT_SRC} ${TAWK_CONNECT_SRC} ${AHREFS_CONNECT_SRC}`,
            `font-src 'self' https://cdn.shopify.com ${TAWK_FONT_SRC} ${GFONTS_FONT_SRC}`,
          ].join("; "),
        },
      ],
    },
    {
      // Auth routes in iframe: allow framing + App Bridge so breakout redirect
      // works. Covers both `/api/auth/shopify` (OAuth start) and
      // `/api/auth/shopify/callback` (returns an HTML breakout page that uses
      // `window.top.location` to leave the iframe — must render to run).
      // MUST come after the deny rule; `:path*` matches zero-or-more segments.
      source: "/api/auth/shopify/:path*",
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
