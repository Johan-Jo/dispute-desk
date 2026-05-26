/**
 * Runtime environment identity validator.
 *
 * Runs once per server process via lib/env/bootstrap.ts (memoized). Validates
 * the SERVER-SECRET surface — presence and shape only, never the values.
 *
 * Contract:
 *   - This module MUST NOT print, hash, or otherwise derive identifiers from
 *     any secret value.
 *   - Variable names + boolean presence + shape (e.g. "is hex 64 chars") only.
 *   - Throws on failure. Caller (bootstrap.ts) decides whether to crash the
 *     process or surface a warning.
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.1b.
 */

import {
  validateBuildIdentity,
  type BuildIdentityInput,
} from "./build-identity";

export class RuntimeIdentityError extends Error {
  constructor(message: string) {
    super(`[env/runtime-identity] ${message}`);
    this.name = "RuntimeIdentityError";
  }
}

export interface RuntimeIdentityInput extends BuildIdentityInput {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  TOKEN_ENCRYPTION_KEY_V1?: string;
  CRON_SECRET?: string;
  EMAIL_FROM?: string;
  EMAIL_SEND_ENABLED?: string;
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Validates runtime secret presence and shape for the given APP_ENV.
 * Pure function — does not read process.env directly so the same logic
 * can be exercised by unit tests with synthetic inputs.
 */
export function validateRuntimeIdentity(env: RuntimeIdentityInput): void {
  // Re-run build-identity first so a process started with bad public env
  // fails for the right reason instead of a confusing secret-shape error.
  validateBuildIdentity(env);

  const required = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SHOPIFY_API_SECRET",
    "TOKEN_ENCRYPTION_KEY_V1",
    "CRON_SECRET",
  ] as const;

  for (const name of required) {
    const v = env[name];
    if (!v || v.length === 0) {
      throw new RuntimeIdentityError(
        `Required secret "${name}" is missing for APP_ENV=${env.APP_ENV}.`,
      );
    }
  }

  // Shape: V1 key must be 32 random bytes = 64 hex chars. A wrong-length
  // key here means token decryption silently breaks at first use.
  if (env.TOKEN_ENCRYPTION_KEY_V1 && !HEX_64.test(env.TOKEN_ENCRYPTION_KEY_V1)) {
    throw new RuntimeIdentityError(
      `TOKEN_ENCRYPTION_KEY_V1 has the wrong shape — expected 64 hex characters (32 bytes).`,
    );
  }

  // Dev sending from the prod mail subdomain while real send is enabled
  // would land in real merchants' inboxes from a dev process. Block it
  // unless EMAIL_SEND_ENABLED is explicitly false (or unset).
  if (
    env.APP_ENV === "development" &&
    env.EMAIL_SEND_ENABLED === "true" &&
    typeof env.EMAIL_FROM === "string" &&
    env.EMAIL_FROM.includes("mail.disputedesk.app")
  ) {
    throw new RuntimeIdentityError(
      `APP_ENV=development with EMAIL_SEND_ENABLED=true but EMAIL_FROM references the prod sending subdomain "mail.disputedesk.app". Use a dev sender or set EMAIL_SEND_ENABLED=false.`,
    );
  }
}

/**
 * Returns variable names with a boolean "present" indicator. Used by the
 * CLI verifier for human-readable output. NEVER returns values, prefixes,
 * or any derivative of values.
 */
export function runtimeIdentityPresence(
  env: RuntimeIdentityInput,
): Array<{ name: string; present: boolean }> {
  const names: Array<keyof RuntimeIdentityInput> = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SHOPIFY_API_SECRET",
    "TOKEN_ENCRYPTION_KEY_V1",
    "CRON_SECRET",
  ];
  return names.map((name) => ({
    name: String(name),
    present: Boolean(env[name] && env[name]!.length > 0),
  }));
}
