"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Intercepts clicks on `<a href="/app/...">` links inside the demo route
 * group and rewrites them to `/demo/...` so navigation stays in the demo.
 *
 * The mirrored pages re-use the real embedded React components, which
 * hard-code links to `/app/disputes/:id`, `/app/settings`, etc. Without
 * this rewriter, every internal click bounces the visitor into the
 * production embedded surface — which 401s without a Shopify session.
 *
 * Implementation: a single document-level click listener (capture phase
 * so it runs before React's synthetic event system) that detects
 * primary-button anchor clicks with an `/app` href and replaces them
 * with the corresponding `/demo` route via Next.js' client router.
 */
export function DemoLinkRewriter() {
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Only primary-button, unmodified clicks
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      // Only rewrite same-origin /app/* hrefs (with optional query string)
      if (!href.startsWith("/app/") && href !== "/app") return;
      // Skip if the anchor opts out of SPA navigation
      if (anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("download")) return;

      const rewritten = href === "/app" ? "/demo" : "/demo" + href.slice(4);
      e.preventDefault();
      router.push(rewritten);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [router]);

  return null;
}
