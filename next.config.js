/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@react-pdf/renderer",
    "@react-pdf/layout",
    "@react-pdf/pdfkit",
    "@react-pdf/primitives",
    "yoga-layout",
  ],
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
            "connect-src 'self' https://*.myshopify.com https://*.supabase.co",
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
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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

module.exports = nextConfig;
