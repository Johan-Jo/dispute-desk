/**
 * Build-time environment identity validator.
 *
 * Operates ONLY on public/build-safe env vars (URLs, public client IDs,
 * env flags). Throws a loud, specific error if any dangerous public-env
 * combination is detected.
 *
 * Imported from next.config.js (build-time) and scripts/verify-env-identity.mjs
 * (CLI). Never imports anything that pulls in server secrets — keeping this
 * module clean of secret access is the contract that makes it safe to call
 * from the build process.
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.1a.
 */

// Production Supabase project ref. Swapped from the legacy Free-tier ref
// `sddzuglxdnkhcnjmcpbj` to the Pro-tier ref `aokhplydttxtebvbeuzc` during the
// 2026-05-28 Free→Pro cutover (the deferred "code-constant" step noted in
// docs/runbooks/prod-release-log.md). Dev runs on a separate fresh project
// `vrpkgudqmpyunekrkpnc`; the old `sddzuglxdnkhcnjmcpbj` ref is now an idle
// leftover, not dev (the "becomes dev" plan was never executed).
export const KNOWN_PROD_SUPABASE_PROJECT_REF = "aokhplydttxtebvbeuzc";
export const KNOWN_PROD_SHOPIFY_CLIENT_ID =
  "84f40ec77c9ba18e9eabc1657d9b6af8";
export const PROD_APP_URL = "https://disputedesk.app";
export const DEV_APP_URL = "https://dev.disputedesk.app";

export type AppEnv = "development" | "production";

export interface BuildIdentityInput {
  APP_ENV?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_CLIENT_ID?: string;
  CRON_ENABLED?: string;
  CRON_ENABLED_DEV_OVERRIDE?: string;
}

export class BuildIdentityError extends Error {
  constructor(message: string) {
    super(`[env/build-identity] ${message}`);
    this.name = "BuildIdentityError";
  }
}

function extractSupabaseRef(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/**
 * Throws BuildIdentityError on any dangerous public-env combination.
 * Pure function — does not read process.env or write logs. Callers are
 * responsible for passing the relevant subset of env vars.
 */
export function validateBuildIdentity(env: BuildIdentityInput): void {
  const appEnv = env.APP_ENV;

  if (!appEnv) {
    throw new BuildIdentityError(
      "APP_ENV is unset. Set APP_ENV=development or APP_ENV=production.",
    );
  }
  if (appEnv !== "development" && appEnv !== "production") {
    throw new BuildIdentityError(
      `APP_ENV must be "development" or "production" (got "${appEnv}").`,
    );
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (appEnv === "production" && appUrl !== PROD_APP_URL) {
    throw new BuildIdentityError(
      `APP_ENV=production but NEXT_PUBLIC_APP_URL is "${appUrl ?? ""}" (expected "${PROD_APP_URL}").`,
    );
  }
  if (appEnv === "development" && appUrl === PROD_APP_URL) {
    throw new BuildIdentityError(
      `APP_ENV=development but NEXT_PUBLIC_APP_URL is "${PROD_APP_URL}" — would point a dev build at the production hostname.`,
    );
  }

  const supabaseRef =
    extractSupabaseRef(env.NEXT_PUBLIC_SUPABASE_URL) ??
    extractSupabaseRef(env.SUPABASE_URL);
  if (appEnv === "development" && supabaseRef === KNOWN_PROD_SUPABASE_PROJECT_REF) {
    throw new BuildIdentityError(
      `APP_ENV=development but Supabase project ref is the production ref "${KNOWN_PROD_SUPABASE_PROJECT_REF}". Refusing to build a dev artifact pointed at prod data.`,
    );
  }
  if (appEnv === "production" && supabaseRef !== KNOWN_PROD_SUPABASE_PROJECT_REF) {
    throw new BuildIdentityError(
      `APP_ENV=production but Supabase project ref is "${supabaseRef ?? "(unset)"}" — expected the known prod ref "${KNOWN_PROD_SUPABASE_PROJECT_REF}".`,
    );
  }

  const shopifyClientId = env.SHOPIFY_API_KEY ?? env.SHOPIFY_CLIENT_ID;
  if (
    appEnv === "development" &&
    shopifyClientId === KNOWN_PROD_SHOPIFY_CLIENT_ID
  ) {
    throw new BuildIdentityError(
      `APP_ENV=development but SHOPIFY_API_KEY equals the known prod client_id. A dev build must use the dev Partners app.`,
    );
  }
  if (
    appEnv === "production" &&
    shopifyClientId !== KNOWN_PROD_SHOPIFY_CLIENT_ID
  ) {
    throw new BuildIdentityError(
      `APP_ENV=production but SHOPIFY_API_KEY is "${(shopifyClientId ?? "").slice(0, 8)}…" — expected the known prod client_id "${KNOWN_PROD_SHOPIFY_CLIENT_ID.slice(0, 8)}…".`,
    );
  }

  if (
    appEnv === "development" &&
    env.CRON_ENABLED === "true" &&
    env.CRON_ENABLED_DEV_OVERRIDE !== "true"
  ) {
    throw new BuildIdentityError(
      `APP_ENV=development with CRON_ENABLED=true requires CRON_ENABLED_DEV_OVERRIDE=true (deliberate opt-in).`,
    );
  }
}

/**
 * Build a short, non-secret summary for logging during the build. Includes:
 *  - APP_ENV
 *  - First 8 chars of Supabase project ref (public)
 *  - First 8 chars of Shopify client_id (public)
 *  - NEXT_PUBLIC_APP_URL hostname
 *
 * NEVER include any secret values, hashes, or fingerprints of secrets here.
 */
export function buildIdentitySummary(env: BuildIdentityInput): string {
  const ref = extractSupabaseRef(
    env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
  );
  const cid = env.SHOPIFY_API_KEY ?? env.SHOPIFY_CLIENT_ID;
  let host = "";
  try {
    host = env.NEXT_PUBLIC_APP_URL ? new URL(env.NEXT_PUBLIC_APP_URL).host : "";
  } catch {
    host = env.NEXT_PUBLIC_APP_URL ?? "";
  }
  return [
    `APP_ENV=${env.APP_ENV ?? "(unset)"}`,
    `appUrl=${host || "(unset)"}`,
    `supabaseRefFp=${(ref ?? "").slice(0, 8) || "(unset)"}`,
    `shopifyClientIdFp=${(cid ?? "").slice(0, 8) || "(unset)"}`,
    `cronEnabled=${env.CRON_ENABLED ?? "(unset)"}`,
  ].join(" ");
}
