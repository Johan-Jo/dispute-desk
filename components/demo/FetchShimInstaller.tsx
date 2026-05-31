"use client";

import { installFetchShim } from "@/lib/demo/fetchShim";

/**
 * Installs the demo fetch shim during render. Renders nothing.
 *
 * React child effects fire BEFORE parent effects, so a useEffect-based
 * installer in the layout runs too late — by then the dashboard has
 * already fired its first /api/setup/state fetch. Installing during
 * render guarantees the shim is in place before any child component's
 * first render, let alone first effect.
 *
 * The shim is idempotent — multiple calls are no-ops.
 */
let installed = false;
if (typeof window !== "undefined" && !installed) {
  installFetchShim();
  installed = true;
}

export function FetchShimInstaller() {
  // Defensive re-install in case the module-level call missed (e.g. SSR
  // hydration race, hot reload). installFetchShim is idempotent.
  if (typeof window !== "undefined") installFetchShim();
  return null;
}
