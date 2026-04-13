import { NextRequest, NextResponse } from "next/server";

const TAWK_PROPERTY_ID = "69dc1d426161b11c33210737";
const TAWK_WIDGET_ID = "1jm1t4isv";

/**
 * GET /api/chat?lang=sv
 *
 * Returns a minimal HTML page that loads the Tawk.to widget with the
 * requested language. Used as the iframe src in the embedded app so
 * the widget language matches the merchant's locale dynamically.
 */
export async function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("lang") ?? "en";

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { margin: 0; padding: 0; }
  html, body { height: 100%; background: #fff; }
</style>
</head>
<body>
<script>
  var Tawk_API = Tawk_API || {};
  Tawk_API.language = "${lang}";
  Tawk_API.onLoad = function () {
    Tawk_API.maximize();
  };
  var Tawk_LoadStart = new Date();
  (function(){
    var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
    s1.async = true;
    s1.src = "https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}";
    s1.charset = "UTF-8";
    s1.setAttribute("crossorigin", "*");
    s0.parentNode.insertBefore(s1, s0);
  })();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=3600",
      // Override the default frame-ancestors 'none' from next.config.js
      // so this page can be loaded in an iframe inside the embedded app.
      "Content-Security-Policy": [
        "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com https://disputedesk.app",
        "default-src 'self'",
        "frame-src 'self' https://tawk.to https://*.tawk.to",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://embed.tawk.to",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://*.tawk.to",
        "connect-src 'self' https://*.tawk.to wss://*.tawk.to",
        "font-src 'self' https://*.tawk.to",
      ].join("; "),
      "X-Frame-Options": "ALLOWALL",
    },
  });
}
