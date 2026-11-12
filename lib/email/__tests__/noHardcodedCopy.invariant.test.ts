/**
 * Email copy lives in messages/*.json, not in lib/ (CLAUDE.md rule 5).
 *
 * Until 2026-11-13 almost every email in lib/email built its sentences in the module itself: English only, or a
 * six-language table (`STRINGS`) inside the file. A Swedish merchant got the fatal-loss and evidence emails in
 * English; the evidence email printed "$" for every currency. The single resolution path is
 * `createTranslator` over `messages/{locale}.json` (see billingLifecycle.ts, sendRefundAdviceAlert.ts).
 *
 * This is a RATCHET. A module in lib/email is CLEAN when it resolves copy through a translator and holds no
 * in-file locale table. Every module that is not clean must be listed in LEGACY below with why; the list can
 * only shrink:
 *   - a new or changed module that is not clean and not listed FAILS (write the copy in messages/*.json);
 *   - a listed module that has become clean, or no longer exists, FAILS (delete its entry).
 * To migrate one: add `email.<name>.*` to all six locales, render through a pure `render…Email(ctx, messages)`
 * (see sendRefundAdviceAlert.ts), add a six-locale render test, then delete the entry.
 *
 * Scope: lib/email/*.ts only. Auth emails (app/api/auth/*), carrier alerts (lib/carriers/alerts.ts) and
 * marketing mail are not scanned here and are tracked separately.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EMAIL_DIR = join(__dirname, "..");

/** Modules with no merchant copy at all: addresses, URL building, text conversion. */
const HELPERS = new Set(["addresses.ts", "publicSiteUrl.ts", "messageBody.ts", "escapeHtml.ts", "insightsDigestGate.ts"]);

const NOT_MIGRATED = "Not yet migrated: builds its copy in lib/ instead of messages/*.json.";
const IN_FILE_TABLE = "Keeps an in-file six-locale table (STRINGS) instead of messages/*.json.";
const OPS =
  "Internal ops email to DisputeDesk staff, English by design today; whether it should be localised is a separate decision, so it stays listed.";

/** module -> why it is not clean yet. Delete the entry when it is migrated. */
const LEGACY: Record<string, string> = {
  // in-file locale tables
  "sendBankClaimNeededAlert.ts": IN_FILE_TABLE,
  "sendDueReminder.ts": IN_FILE_TABLE,
  "sendGorgiasEvidenceReadyAlert.ts": IN_FILE_TABLE,
  "sendNewDisputeAlert.ts": IN_FILE_TABLE,
  "sendOutcomePostedAlert.ts": `${IN_FILE_TABLE} (Also resolves some tokens through messages.)`,
  "sendPackSavedAlert.ts": IN_FILE_TABLE,
  // internal ops
  "adminEmail.ts": OPS,
  "sendAdminNotification.ts": OPS,
  "sendDeadlineNoFileAdminAlert.ts": OPS,
  "sendDefencePackageFailedAlert.ts": OPS,
  "sendQueryFieldDriftAlert.ts": OPS,
  "sendQueryFieldDriftResolvedAlert.ts": OPS,
  "sendReasonEnumDriftAlert.ts": OPS,
  "sendReasonEnumDriftResolvedAlert.ts": OPS,
  "sendSaveFailedAdminAlert.ts": OPS,
  "sendUnknownReasonAlert.ts": OPS,
  // not yet migrated
  "digestDisputeActivity.ts": NOT_MIGRATED,
  "digestShared.ts": NOT_MIGRATED,
  "installWelcomeTemplate.ts": NOT_MIGRATED,
  "noOrdersInstallTemplate.ts": NOT_MIGRATED,
  "sendCaseStrengthenedAlert.ts": NOT_MIGRATED,
  "sendConfirmationEmail.ts": NOT_MIGRATED,
  "sendDefenceDeadlineFallbackAlert.ts": NOT_MIGRATED,
  "sendHighValueReviewAlert.ts": NOT_MIGRATED,
  "sendInstallWelcome.ts": NOT_MIGRATED,
  "sendMagicLink.ts": NOT_MIGRATED,
  "sendMonthlyChargebackDigest.ts": NOT_MIGRATED,
  "sendOnboardingAnalysisDigest.ts": NOT_MIGRATED,
  "sendPartialGenerationAlert.ts": NOT_MIGRATED,
  "sendPasswordResetEmail.ts": NOT_MIGRATED,
  "sendPublishNotification.ts": NOT_MIGRATED,
  "sendWelcome.ts": NOT_MIGRATED,
  "templates.ts": NOT_MIGRATED,
  "triggerOnboardingDigest.ts": NOT_MIGRATED,
};

const modules = readdirSync(EMAIL_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const source = (f: string) => readFileSync(join(EMAIL_DIR, f), "utf8");

/** Resolves copy through a translator and holds no in-file locale table. */
export function isClean(src: string): boolean {
  return /createTranslator|getTranslations|resolveToken/.test(src) && !/\bSTRINGS\b/.test(src);
}

describe("email copy lives in messages/*.json", () => {
  it("every email module is clean, a helper, or listed as legacy", () => {
    const offenders = modules.filter((f) => !HELPERS.has(f) && !(f in LEGACY) && !isClean(source(f)));
    expect(
      offenders,
      `${offenders.join(", ")}: resolve this email's copy through createTranslator over messages/*.json ` +
        "(see sendRefundAdviceAlert.ts). Do not add it to LEGACY.",
    ).toEqual([]);
  });

  it("ratchet: nothing listed as legacy is clean or missing (delete the entry)", () => {
    const stale = Object.keys(LEGACY).filter((f) => !modules.includes(f) || isClean(source(f)));
    expect(stale, `${stale.join(", ")} is clean or gone: delete it from LEGACY.`).toEqual([]);
  });

  it("every legacy entry says why", () => {
    for (const [f, why] of Object.entries(LEGACY)) expect(why.trim().length, f).toBeGreaterThanOrEqual(20);
  });

  it("helpers hold no in-file locale table", () => {
    for (const f of HELPERS) expect(/\bSTRINGS\b/.test(source(f)), f).toBe(false);
  });

  it("the emails migrated so far are clean", () => {
    for (const f of [
      "billingLifecycle.ts",
      "sendRefundAdviceAlert.ts",
      "sendFatalLossAlert.ts",
      "sendEvidenceNeededAlert.ts",
    ]) {
      expect(isClean(source(f)), `${f} regressed to in-file copy`).toBe(true);
    }
  });
});
