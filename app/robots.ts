import type { MetadataRoute } from "next";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

const BASE_URL = getPublicSiteBaseUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/app/", "/portal/", "/auth/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
