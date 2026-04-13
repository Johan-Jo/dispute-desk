"use client";

import { useLocale } from "next-intl";
import Script from "next/script";

const TAWK_PROPERTY_ID = "69dc1d426161b11c33210737";
const TAWK_WIDGET_ID = "1jm1t4isv";

export function TawkToWidget() {
  const locale = useLocale();
  const lang = locale.split("-")[0];

  return (
    <Script
      id="tawk-to"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          var Tawk_API = Tawk_API || {};
          Tawk_API.language = "${lang}";
          var Tawk_LoadStart = new Date();
          (function(){
            var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
            s1.async = true;
            s1.src = "https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}";
            s1.charset = "UTF-8";
            s1.setAttribute("crossorigin", "*");
            s0.parentNode.insertBefore(s1, s0);
          })();
        `,
      }}
    />
  );
}
