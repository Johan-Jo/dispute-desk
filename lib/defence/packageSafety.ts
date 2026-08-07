/**
 * The ONE predicate that decides whether a defence-package candidate may be
 * saved to Shopify or forwarded (PR-C1).
 *
 * WHY A CENTRAL PREDICATE. A code release stops NEW unsafe output; it does
 * nothing about packages already sitting in `defence_packages`, where a large
 * fraction carry a retired delivery boolean, an address-delivery assertion, or
 * supporting JSON that cannot be inspected. Without a block, the very next
 * auto-save, manual save, or deadline run would file one. (The measured
 * population is reported in the PR description and `docs/technical.md`, with
 * its census timestamp — it is deliberately NOT restated here, because a
 * number in a comment rots and then contradicts the report.)
 *
 * CANDIDATE-BASED, NOT DISPUTE-BASED. Unsafety is a property of one persisted
 * version, never of the dispute:
 *   - a historical unsafe version stays immutable and stays blocked;
 *   - a newly regenerated safe version is a different candidate and is usable;
 *   - the existence of an older unsafe version must never permanently block a
 *     dispute;
 *   - and a selector must never fall back from a new safe-or-failed candidate
 *     to an older unsafe one. Both selectors (`saveToShopifyJob` §3 and the
 *     deadline cron) already take `order by version desc limit 1` — the latest
 *     candidate only — and this module must not be used to reintroduce a
 *     search for "the newest SAFE version", which would be exactly that
 *     forbidden fallback.
 *
 * NOT A DATA REWRITE. Nothing here mutates a package. Unsafe candidates stay
 * viewable; they are refused at the save/forward boundary and the merchant is
 * told why.
 */

import { classifyAddressDeliveryClaim } from "./claimCapabilities";
import {
  RETIRED_PAYLOAD_KEYS,
  type RetiredPayloadKey,
} from "@/lib/evidence/model/retiredKeys";

export type PackageUnsafeReason =
  /** A persisted fact value still carries a retired delivery boolean. */
  | "retired_delivery_fact"
  /** The narrative affirmatively asserts delivery at a particular address. */
  | "affirmative_address_delivery_claim"
  /** Address-delivery language we could not resolve. Fails closed. */
  | "ambiguous_address_delivery_claim"
  /** `facts_json` is null, malformed, or in a shape we do not recognise. */
  | "unreadable_facts_json"
  /** `narrative_json` is null, malformed, or in a shape we do not recognise. */
  | "unreadable_narrative_json";

export interface PackageSafetyVerdict {
  safe: boolean;
  reasons: PackageUnsafeReason[];
  /** Retired keys found, for the audit row. Never merchant- or bank-facing. */
  retiredKeys: RetiredPayloadKey[];
}

export interface PackageSafetyInput {
  /** `defence_packages.facts_json` exactly as persisted. */
  factsJson: unknown;
  /** `defence_packages.narrative_json` exactly as persisted. */
  narrativeJson: unknown;
}

/**
 * FAIL CLOSED, SCHEMA-AWARE. A candidate we cannot fully inspect is
 * UNRESOLVED, never "proven safe". A final PDF whose supporting JSON is null,
 * incomplete, or carries a shape this parser does not model may hold an
 * unknown claim, and an unknown claim may not be filed.
 *
 * THREE REVISIONS, TWO OF THEM WRONG. The first validated only the outer
 * container, so `[{}]` and `[{ value: "unexpected" }]` passed as "readable,
 * no retired keys". The second validated ten of a fact's thirteen fields and
 * tolerated unknown keys, and accepted a narrative with ONE section, a section
 * missing `usedFactIds`, and extra nested keys inside a known section. Both
 * left structure the parser had never looked at, which is the same blind spot
 * in a smaller box.
 *
 * This revision validates the measured contract EXACTLY and rejects anything
 * else. A future schema addition is therefore a deliberate parser update, not
 * a silent widening — which is the only version of "fail closed" that means
 * anything.
 *
 * SCHEMA v1, measured read-only at KEY and TYPE level over all 280 candidates
 * / 2 576 fact objects / 2 169 narrative sections in production at
 * 2026-08-07T17:55:11Z. Every count below is 100 % uniform:
 *
 *   facts_json      241 × array of objects, every object EXACTLY these 13:
 *                   {bankEligible, category, confidence, id,
 *                    includeInBankNarrative, internalOnly, label,
 *                    merchantVisible, source, sourceRef, strength,
 *                    submissionRisk, value}
 *                   · 5 strings, 5 booleans · value: object 2576/2576
 *                   · sourceRef: string 2143 / null 433 · confidence: null 2576
 *                   39 × null
 *   narrative_json  241 × object, top-level keys EXACTLY the 9 section keys +
 *                   omittedSections + warnings (241/241 carry all eleven)
 *                   · every section exactly {text, usedFactIds}: 2169 = 241×9
 *                   · usedFactIds: array 2169/2169, elements string 4460/4460
 *                   · omittedSections: array; elements exactly
 *                     {reason, sectionKey}, both string, 760/760;
 *                     sectionKey ∈ the 9 section keys
 *                   · warnings: array; elements string 535/535
 *                   39 × null
 *
 * All 39 nulls are `failed` (37), `skipped` (1) and `stale` (1) — zero final,
 * zero submitted — so failing closed on them blocks nothing otherwise
 * fileable. Widening either schema requires re-running the census.
 */

/** The persisted schema this parser models. Bump on any deliberate widening;
 *  it is quoted in the block audit so a refusal is traceable to a contract. */
export const PACKAGE_SCHEMA_VERSION = 1;

/** Exactly the 13 keys of `EvidenceFact`, by required value type. */
const FACT_STRING_KEYS = ["id", "category", "label", "source", "strength"] as const;
const FACT_BOOLEAN_KEYS = [
  "bankEligible",
  "includeInBankNarrative",
  "internalOnly",
  "merchantVisible",
  "submissionRisk",
] as const;
/** `sourceRef: string | null`, `confidence: number | null`, `value: object`. */
const FACT_NULLABLE_STRING_KEYS = ["sourceRef"] as const;
const FACT_NULLABLE_NUMBER_KEYS = ["confidence"] as const;

const FACT_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  ...FACT_STRING_KEYS,
  ...FACT_BOOLEAN_KEYS,
  ...FACT_NULLABLE_STRING_KEYS,
  ...FACT_NULLABLE_NUMBER_KEYS,
  "value",
]);

/**
 * All 13 fields, their measured types, and NO unknown keys.
 *
 * Unknown keys are rejected rather than tolerated. The previous revision
 * argued an extra key was harmless "because the retired-key scan reads
 * `value` directly" — but that only holds if every extra branch is
 * structurally inspected, and it was not. Rejecting is the honest version:
 * an added field must arrive with a parser update and a fresh census.
 *
 * `confidence` is `number | null` in the declared contract and null in all
 * 2 576 measured facts; a finite number is accepted so a legitimate future
 * value is not a fleet-wide block, and nothing else is.
 */
function isValidFactObject(f: unknown): f is Record<string, unknown> {
  if (!f || typeof f !== "object" || Array.isArray(f)) return false;
  const o = f as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!FACT_ALLOWED_KEYS.has(k)) return false;
  for (const k of FACT_STRING_KEYS) if (typeof o[k] !== "string") return false;
  for (const k of FACT_BOOLEAN_KEYS) if (typeof o[k] !== "boolean") return false;
  for (const k of FACT_NULLABLE_STRING_KEYS) {
    if (!(k in o)) return false;
    if (o[k] !== null && typeof o[k] !== "string") return false;
  }
  for (const k of FACT_NULLABLE_NUMBER_KEYS) {
    if (!(k in o)) return false;
    if (o[k] !== null && !(typeof o[k] === "number" && Number.isFinite(o[k]))) return false;
  }
  // `value` is the payload the retired-key scan reads. A non-object value is
  // exactly the `{ value: "unexpected" }` case: uninspectable, so unresolved.
  if (!o.value || typeof o.value !== "object" || Array.isArray(o.value)) return false;
  return true;
}

type FactsRead =
  | { readable: true; facts: Record<string, unknown>[] }
  | { readable: false };

function readFacts(factsJson: unknown): FactsRead {
  if (!Array.isArray(factsJson)) return { readable: false };
  const facts: Record<string, unknown>[] = [];
  for (const entry of factsJson) {
    if (!isValidFactObject(entry)) return { readable: false };
    facts.push(entry);
  }
  // An empty list is a legitimate readable shape (a package with no approved
  // facts). The canonical contract permits it, so it is not "unreadable".
  return { readable: true, facts };
}

/** The 9 narrative section keys, each `{ text: string, usedFactIds }`. */
const NARRATIVE_SECTION_KEYS = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
] as const;

/** Permitted non-section metadata keys, both arrays. */
const NARRATIVE_METADATA_KEYS = ["omittedSections", "warnings"] as const;

const NARRATIVE_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  ...NARRATIVE_SECTION_KEYS,
  ...NARRATIVE_METADATA_KEYS,
]);

const NARRATIVE_SECTION_KEY_SET: ReadonlySet<string> = new Set<string>(NARRATIVE_SECTION_KEYS);

/** A section is EXACTLY `{ text: string, usedFactIds: string[] }`. */
function isValidNarrativeSection(section: unknown): boolean {
  if (!section || typeof section !== "object" || Array.isArray(section)) return false;
  const s = section as Record<string, unknown>;
  const keys = Object.keys(s);
  if (keys.length !== 2) return false;
  if (typeof s.text !== "string") return false;
  if (!Array.isArray(s.usedFactIds)) return false;
  return s.usedFactIds.every((id) => typeof id === "string");
}

/** `omittedSections` is an array of exactly `{ sectionKey, reason }`, both
 *  strings, with `sectionKey` naming a real section. */
function isValidOmittedSections(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    const keys = Object.keys(e);
    if (keys.length !== 2) return false;
    if (typeof e.reason !== "string") return false;
    return typeof e.sectionKey === "string" && NARRATIVE_SECTION_KEY_SET.has(e.sectionKey);
  });
}

/** `warnings` is an array of strings. */
function isValidWarnings(value: unknown): boolean {
  return Array.isArray(value) && value.every((w) => typeof w === "string");
}

type NarrativeRead =
  | { readable: true; texts: string[] }
  | { readable: false };

/**
 * Every string anywhere in the value, at any depth.
 *
 * Belt and braces with the key allowlist below: even if an unknown branch
 * somehow reached the detector, its prose would still be READ rather than
 * skipped. A denylist that ignores what it does not recognise is how
 * `{ unknownSection: { nested: { text } } }` went uninspected.
 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/**
 * The measured contract, enforced exactly: all eleven top-level keys, no
 * others, every section in the approved shape, and both metadata arrays
 * element-validated.
 *
 * The previous revision accepted a narrative with a single section and no
 * `usedFactIds`, which is not a shape production has ever held — and the tests
 * that "proved" the parser used exactly those incomplete fixtures.
 */
function readNarrative(narrativeJson: unknown): NarrativeRead {
  if (!narrativeJson || typeof narrativeJson !== "object" || Array.isArray(narrativeJson)) {
    return { readable: false };
  }
  const o = narrativeJson as Record<string, unknown>;

  // Unknown top-level key → unresolved. Ignoring it is what let an unknown
  // nested structure carry uninspected prose past the check.
  for (const k of Object.keys(o)) if (!NARRATIVE_ALLOWED_KEYS.has(k)) return { readable: false };

  // Every one of the nine sections must be present and exactly shaped. A
  // narrative missing a section is not a narrative this parser has measured,
  // and the generator has never produced one — `narrativeWriter` rejects the
  // model's JSON outright if any section is absent.
  for (const k of NARRATIVE_SECTION_KEYS) {
    if (!isValidNarrativeSection(o[k])) return { readable: false };
  }

  if (!isValidOmittedSections(o.omittedSections)) return { readable: false };
  if (!isValidWarnings(o.warnings)) return { readable: false };

  const texts: string[] = [];
  collectStrings(o, texts);
  return { readable: true, texts };
}

/** Prose from a persisted `narrative_json`. Empty when unreadable — callers
 *  must consult `assessPackageCandidateSafety`, which fails closed. */
export function narrativeTexts(narrativeJson: unknown): string[] {
  const read = readNarrative(narrativeJson);
  return read.readable ? read.texts : [];
}

export function assessPackageCandidateSafety(
  input: PackageSafetyInput,
): PackageSafetyVerdict {
  const reasons = new Set<PackageUnsafeReason>();
  const retiredKeys = new Set<RetiredPayloadKey>();

  const facts = readFacts(input.factsJson);
  if (!facts.readable) {
    reasons.add("unreadable_facts_json");
  } else {
    for (const fact of facts.facts) {
      const value = fact.value;
      if (!value || typeof value !== "object") continue;
      for (const key of RETIRED_PAYLOAD_KEYS) {
        if (key in (value as Record<string, unknown>)) {
          retiredKeys.add(key);
          reasons.add("retired_delivery_fact");
        }
      }
    }
  }

  const narrative = readNarrative(input.narrativeJson);
  if (!narrative.readable) {
    reasons.add("unreadable_narrative_json");
  } else {
    for (const text of narrative.texts) {
      const verdict = classifyAddressDeliveryClaim(text);
      if (verdict === "affirmative") reasons.add("affirmative_address_delivery_claim");
      else if (verdict === "ambiguous") reasons.add("ambiguous_address_delivery_claim");
    }
  }

  return {
    safe: reasons.size === 0,
    reasons: [...reasons],
    retiredKeys: [...retiredKeys],
  };
}

/** Merchant-safe explanation for the block. No bank-facing language, no
 *  gateway codes, no address data, and no internal JSON detail. */
export function packageBlockSummary(verdict: PackageSafetyVerdict): string {
  if (verdict.safe) return "";
  const unreadable =
    verdict.reasons.includes("unreadable_facts_json") ||
    verdict.reasons.includes("unreadable_narrative_json");
  if (unreadable) {
    return (
      "This defence package cannot be reviewed automatically, so it will not be " +
      "filed. Regenerate the package to produce a version that can be submitted."
    );
  }
  return (
    "This defence package was built with a delivery-address claim DisputeDesk " +
    "can no longer support, so it will not be filed. Regenerate the package to " +
    "produce a version that can be submitted."
  );
}


/* ── Preflight: an explicit, fail-closed result contract ──────────────────
 *
 * The first revision returned `{candidate, verdict, isCurrent}` and DISCARDED
 * Supabase errors. Four fail-open holes followed from that:
 *
 *   - a failed latest-candidate query became "no candidate" → SAFE;
 *   - a failed named-candidate query returned candidate:null + SAFE;
 *   - `preflightBlocks` only checked `!isCurrent` when `candidate !== null`,
 *     so that null result did not block either;
 *   - a failed latest-VERSION query made a stale named package look current.
 *
 * A transient database failure is not evidence of safety. The outcome is now a
 * discriminated union with exactly ONE proceeding member, so a caller cannot
 * accidentally treat any other state as "fine".
 * ---------------------------------------------------------------------- */

export type PreflightOutcome =
  /** Inspected, and every check passed. THE ONLY state that may proceed. */
  | { kind: "safe"; candidate: CandidateRow }
  /** Inspected, and the candidate carries an unsafe or unresolved claim. */
  | { kind: "blocked"; candidate: CandidateRow; verdict: PackageSafetyVerdict }
  /** No defence-package candidate exists for this dispute at all. */
  | { kind: "missing" }
  /** The named candidate exists but is no longer the newest version. */
  | { kind: "not_current"; candidate: CandidateRow; latestId: string | null }
  /**
   * Content-safe, but not in a state the worker could ever file: not `final`,
   * validation not `ok`, or no PDF. Only requested by callers that enqueue a
   * save (see `requireFileable`) — the finalize route legitimately operates on
   * a draft, which is the whole point of finalizing.
   */
  | { kind: "not_fileable"; candidate: CandidateRow; reasons: string[] }
  /** A query failed, or a row came back unreadable. Never read as safe. */
  | { kind: "error"; message: string };

interface CandidateRow {
  id: string;
  version: number;
  status?: string | null;
  validation_status?: string | null;
  pdf_path?: string | null;
  facts_json?: unknown;
  narrative_json?: unknown;
}

const SELECT_COLS =
  "id, version, status, validation_status, pdf_path, facts_json, narrative_json";

export interface PreflightOptions {
  /**
   * Also require the candidate to be one the save worker could actually file.
   *
   * `saveToShopifyJob` §3 hard-requires the LATEST defence package to be
   * `status='final'` with a `pdf_path`. Routes that approve or enqueue a save
   * without checking that were handing the merchant a 202 for a job destined
   * to fail — and the manual-save route additionally stamped the evidence pack
   * `saving`, so the UI showed a save in progress that could not complete.
   *
   * `validation_status = 'ok'` is required on top of the worker's two checks:
   * a `final` package that failed validation is finalizable only by a bug, and
   * refusing it here is strictly safer than filing it.
   */
  requireFileable?: boolean;
  /**
   * The mirror requirement for a caller that is about to PROMOTE the
   * candidate: it must still be the eligible draft the caller believes it is.
   *
   * `finalizeAndEnqueueSave` performs a `draft → final` transition, so
   * `requireFileable` (which demands `final`) is the wrong predicate there —
   * it would reject every legitimate input. This one demands `draft` +
   * `validation_status = 'ok'` + a PDF, which is exactly the set of
   * preconditions the guarded UPDATE then re-asserts against the row.
   */
  requireFinalizable?: boolean;
}

const FILEABLE_STATUS = "final";
const FINALIZABLE_STATUS = "draft";

function hasPdf(c: CandidateRow): boolean {
  return typeof c.pdf_path === "string" && c.pdf_path.trim().length > 0;
}

/** Why this content-safe candidate still cannot be filed. */
function fileabilityReasons(c: CandidateRow): string[] {
  const reasons: string[] = [];
  if ((c.status ?? null) !== FILEABLE_STATUS) reasons.push("candidate_not_final");
  if ((c.validation_status ?? null) !== "ok") reasons.push("candidate_validation_not_ok");
  if (!hasPdf(c)) reasons.push("candidate_missing_pdf");
  return reasons;
}

/** Why this content-safe candidate cannot be promoted to final. */
function finalizabilityReasons(c: CandidateRow): string[] {
  const reasons: string[] = [];
  if ((c.status ?? null) !== FINALIZABLE_STATUS) reasons.push("candidate_not_draft");
  if ((c.validation_status ?? null) !== "ok") reasons.push("candidate_validation_not_ok");
  if (!hasPdf(c)) reasons.push("candidate_missing_pdf");
  return reasons;
}

/** Minimal Supabase surface these helpers use — structural so tests can pass a
 *  hand-rolled mock without importing the client type. */
type SbLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

function asCandidateRow(data: unknown): CandidateRow | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.version !== "number") return null;
  return r as unknown as CandidateRow;
}

function judge(candidate: CandidateRow, opts?: PreflightOptions): PreflightOutcome {
  const verdict = assessPackageCandidateSafety({
    factsJson: candidate.facts_json,
    narrativeJson: candidate.narrative_json,
  });
  if (!verdict.safe) return { kind: "blocked", candidate, verdict };
  if (opts?.requireFileable) {
    const reasons = fileabilityReasons(candidate);
    if (reasons.length > 0) return { kind: "not_fileable", candidate, reasons };
  }
  if (opts?.requireFinalizable) {
    const reasons = finalizabilityReasons(candidate);
    if (reasons.length > 0) return { kind: "not_fileable", candidate, reasons };
  }
  return { kind: "safe", candidate };
}

/**
 * The newest candidate for a dispute, judged. Used by paths that do not name a
 * specific package: auto-save, the manual save route, the portal approval
 * route, the deadline cron, the worker.
 */
export async function preflightLatestCandidate(
  sb: SbLike,
  disputeId: string,
  opts?: PreflightOptions,
): Promise<PreflightOutcome> {
  const res = await sb
    .from("defence_packages")
    .select(SELECT_COLS)
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res?.error) {
    return {
      kind: "error",
      message: `latest_candidate_query_failed: ${res.error.message ?? "unknown"}`,
    };
  }
  if (res?.data == null) return { kind: "missing" };
  const row = asCandidateRow(res.data);
  if (!row) return { kind: "error", message: "latest_candidate_row_unreadable" };
  return judge(row, opts);
}

/**
 * A NAMED candidate, judged — plus proof it is still the newest version.
 *
 * The named-package routes must not claim to be "pinned": they enqueue a job
 * keyed to the source pack and the worker independently re-selects the latest
 * version. Judging only the named row would leave a window where the merchant
 * approves v3 and the worker files v4.
 */
export async function preflightNamedCandidate(
  sb: SbLike,
  args: { packageId: string; disputeId: string },
  opts?: PreflightOptions,
): Promise<PreflightOutcome> {
  const [namedRes, latestRes] = await Promise.all([
    sb.from("defence_packages").select(SELECT_COLS).eq("id", args.packageId).maybeSingle(),
    sb
      .from("defence_packages")
      .select("id, version")
      .eq("dispute_id", args.disputeId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (namedRes?.error) {
    return {
      kind: "error",
      message: `named_candidate_query_failed: ${namedRes.error.message ?? "unknown"}`,
    };
  }
  // A failed latest lookup CANNOT be read as "the named row is current" —
  // that was one of the four holes.
  if (latestRes?.error) {
    return {
      kind: "error",
      message: `latest_version_query_failed: ${latestRes.error.message ?? "unknown"}`,
    };
  }
  if (namedRes?.data == null) return { kind: "missing" };

  const named = asCandidateRow(namedRes.data);
  if (!named) return { kind: "error", message: "named_candidate_row_unreadable" };

  const latestId =
    latestRes?.data && typeof (latestRes.data as Record<string, unknown>).id === "string"
      ? ((latestRes.data as Record<string, unknown>).id as string)
      : null;
  // No latest row while the named row exists is contradictory, not reassuring.
  if (latestId === null) return { kind: "error", message: "latest_version_row_unreadable" };
  if (latestId !== named.id) return { kind: "not_current", candidate: named, latestId };

  return judge(named, opts);
}

/** True unless the outcome is the single proceeding state. */
export function preflightBlocks(p: PreflightOutcome): boolean {
  return p.kind !== "safe";
}

/** Machine-readable reasons for the audit row and the API body. */
export function preflightReasons(p: PreflightOutcome): string[] {
  switch (p.kind) {
    case "safe":
      return [];
    case "blocked":
      return [...p.verdict.reasons];
    case "missing":
      return ["no_defence_package"];
    case "not_current":
      return ["candidate_not_current"];
    case "not_fileable":
      return [...p.reasons];
    case "error":
      return ["preflight_error"];
  }
}

/** Retired keys found, when the candidate was inspectable. */
export function preflightRetiredKeys(p: PreflightOutcome): RetiredPayloadKey[] {
  return p.kind === "blocked" ? p.verdict.retiredKeys : [];
}

/** The candidate that was judged, when there was one. */
export function preflightCandidate(p: PreflightOutcome): CandidateRow | null {
  switch (p.kind) {
    case "safe":
    case "blocked":
    case "not_current":
    case "not_fileable":
      return p.candidate;
    default:
      return null;
  }
}

/**
 * A CONTENT verdict — the package itself carries an unsupported or
 * uninspectable claim. Distinct from every other blocking outcome, all of
 * which are lifecycle or infrastructure states.
 *
 * This distinction is load-bearing: only a content block may park a dispute
 * with a merchant-facing "review required" banner, because only a content
 * block is fixed by regenerating. A database timeout or a not-yet-built
 * package raising that banner tells the merchant to fix something that is not
 * broken, and (for the timeout) hides an outage behind a content warning.
 */
export function preflightIsContentBlock(p: PreflightOutcome): boolean {
  return p.kind === "blocked";
}

/**
 * TRANSIENT — a database failure, not a property of the package.
 *
 * Callers must not tell the merchant to regenerate in this case (regeneration
 * does not fix a database outage), and background callers should retry rather
 * than park permanently.
 */
export function preflightIsTransient(p: PreflightOutcome): boolean {
  return p.kind === "error";
}

/**
 * TRANSIENT-BY-WAITING — the package simply does not exist yet.
 *
 * Not a defect either: the build is still to come. Background paths defer;
 * merchant paths say "not generated yet" rather than "regenerate".
 */
export function preflightIsPending(p: PreflightOutcome): boolean {
  return p.kind === "missing";
}

/**
 * The ONE HTTP mapping for a blocking preflight, so the four merchant-facing
 * endpoints cannot drift:
 *
 *   blocked / missing / not_current  422 PACKAGE_REVIEW_REQUIRED
 *   not_fileable                     409 PACKAGE_NOT_FILEABLE
 *   error                            503 PACKAGE_CHECK_UNAVAILABLE
 *
 * 503 matters on its own: a failed check is an outage, and telling the
 * merchant to regenerate would send them to fix a package that is fine.
 */
export function preflightHttpRefusal(p: PreflightOutcome): {
  status: number;
  code: string;
  reasons: string[];
  message: string;
} {
  const code =
    p.kind === "error"
      ? "PACKAGE_CHECK_UNAVAILABLE"
      : p.kind === "not_fileable"
        ? "PACKAGE_NOT_FILEABLE"
        : "PACKAGE_REVIEW_REQUIRED";
  const status = p.kind === "error" ? 503 : p.kind === "not_fileable" ? 409 : 422;
  return { status, code, reasons: preflightReasons(p), message: preflightSummary(p) };
}

/** Merchant-safe message for a blocking preflight. Never exposes JSON detail,
 *  gateway codes, addresses, or a database error string. */
export function preflightSummary(p: PreflightOutcome): string {
  switch (p.kind) {
    case "safe":
      return "";
    case "blocked":
      return packageBlockSummary(p.verdict);
    case "missing":
      return (
        "The defence package for this dispute has not been generated yet. It " +
        "will become available once the package finishes building."
      );
    case "not_current":
      return (
        "A newer version of this defence package exists. Refresh and review the " +
        "latest version before submitting."
      );
    case "not_fileable":
      return p.reasons.includes("candidate_not_final")
        ? "This defence package has not been approved yet. Approve the latest " +
            "version before saving it to Shopify."
        : "This defence package is not ready to be filed. Regenerate the " +
            "package and try again.";
    case "error":
      return (
        "We could not check this defence package just now. Please try again in " +
        "a few minutes."
      );
  }
}
