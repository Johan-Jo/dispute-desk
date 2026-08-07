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
 * FAIL CLOSED. A candidate we cannot inspect is UNRESOLVED, never "proven
 * safe". A final PDF whose supporting JSON is null or in a shape this parser
 * does not recognise carries an unknown claim, and an unknown claim may not be
 * filed.
 *
 * The accepted shapes are the ones production actually holds, measured
 * read-only over all 280 persisted candidates at 2026-08-07T13:14:52.052Z:
 *
 *   facts_json      241 × bare `array[object]`   ·  39 × null
 *   narrative_json  241 × section object          ·  39 × null
 *
 * All 39 nulls are `failed` (37), `skipped` (1) and `stale` (1) — **zero
 * final, zero submitted** — so failing closed on them blocks nothing that
 * could otherwise be filed. No wrapper shape (`{approved: […]}` etc.) exists
 * in production; an earlier revision accepted three speculative wrappers, and
 * that is exactly how an unknown shape silently becomes "no facts found, so
 * nothing unsafe". Only the measured shapes are accepted; widening this
 * requires re-running the census.
 */
type FactsRead =
  | { readable: true; facts: Record<string, unknown>[] }
  | { readable: false };

function readFacts(factsJson: unknown): FactsRead {
  if (!Array.isArray(factsJson)) return { readable: false };
  const facts: Record<string, unknown>[] = [];
  for (const entry of factsJson) {
    // A non-object member means the array is not the fact list we know.
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { readable: false };
    }
    facts.push(entry as Record<string, unknown>);
  }
  return { readable: true, facts };
}

type NarrativeRead =
  | { readable: true; texts: string[] }
  | { readable: false };

function readNarrative(narrativeJson: unknown): NarrativeRead {
  if (!narrativeJson || typeof narrativeJson !== "object" || Array.isArray(narrativeJson)) {
    return { readable: false };
  }
  const entries = Object.entries(narrativeJson as Record<string, unknown>);
  if (entries.length === 0) return { readable: false };
  const texts: string[] = [];
  let sawSection = false;
  for (const [, value] of entries) {
    if (typeof value === "string") {
      sawSection = true;
      texts.push(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const text = (value as Record<string, unknown>).text;
      if (typeof text === "string") {
        sawSection = true;
        texts.push(text);
      }
    }
  }
  // `omittedSections` / `warnings` are arrays and carry no prose, so an object
  // made only of those is not a narrative we can inspect.
  if (!sawSection) return { readable: false };
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

/* ── Shared preflight loaders ─────────────────────────────────────────────
 *
 * Every enqueue site consults ONE of these two functions, so the "which row do
 * I judge?" question has a single answer per situation and cannot drift.
 * ---------------------------------------------------------------------- */

interface CandidateRow {
  id: string;
  version: number;
  status?: string | null;
  facts_json?: unknown;
  narrative_json?: unknown;
}

export interface CandidatePreflight {
  /** The row that was judged. Null when no candidate exists at all. */
  candidate: CandidateRow | null;
  verdict: PackageSafetyVerdict;
  /** True when the judged row is also the newest version for the dispute. */
  isCurrent: boolean;
}

const SELECT_COLS = "id, version, status, facts_json, narrative_json";

/** Minimal Supabase surface these helpers use — kept structural so tests can
 *  pass a hand-rolled mock without importing the client type. */
type SbLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const SAFE: PackageSafetyVerdict = { safe: true, reasons: [], retiredKeys: [] };

/** The newest candidate for a dispute, judged. Used by paths that do not name
 *  a specific package (auto-save, the worker, the deadline cron). */
export async function preflightLatestCandidate(
  sb: SbLike,
  disputeId: string,
): Promise<CandidatePreflight> {
  const { data } = await sb
    .from("defence_packages")
    .select(SELECT_COLS)
    .eq("dispute_id", disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { candidate: null, verdict: SAFE, isCurrent: true };
  return {
    candidate: data as CandidateRow,
    verdict: assessPackageCandidateSafety({
      factsJson: (data as CandidateRow).facts_json,
      narrativeJson: (data as CandidateRow).narrative_json,
    }),
    isCurrent: true,
  };
}

/**
 * A NAMED candidate, judged — plus proof that it is still the newest version.
 *
 * The named-package routes must not claim to be "pinned": they enqueue a job
 * keyed to the source pack, and the worker independently re-selects the latest
 * version. So judging only the named row would leave a window where the
 * merchant approves version 3 and the worker files version 4. `isCurrent`
 * makes that visible, and callers refuse when it is false.
 */
export async function preflightNamedCandidate(
  sb: SbLike,
  args: { packageId: string; disputeId: string },
): Promise<CandidatePreflight> {
  const [{ data: named }, { data: latest }] = await Promise.all([
    sb.from("defence_packages").select(SELECT_COLS).eq("id", args.packageId).maybeSingle(),
    sb
      .from("defence_packages")
      .select("id, version")
      .eq("dispute_id", args.disputeId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!named) return { candidate: null, verdict: SAFE, isCurrent: false };
  const row = named as CandidateRow;
  return {
    candidate: row,
    verdict: assessPackageCandidateSafety({
      factsJson: row.facts_json,
      narrativeJson: row.narrative_json,
    }),
    isCurrent: !latest || (latest as { id: string }).id === row.id,
  };
}

/** True when this preflight must stop the caller: unsafe, unresolved, or a
 *  named row the worker would not actually file. */
export function preflightBlocks(p: CandidatePreflight): boolean {
  return !p.verdict.safe || (p.candidate !== null && !p.isCurrent);
}

/** Reason codes for the audit row / API body, including the staleness case. */
export function preflightReasons(p: CandidatePreflight): string[] {
  const out: string[] = [...p.verdict.reasons];
  if (p.candidate !== null && !p.isCurrent) out.push("candidate_not_current");
  return out;
}

/** Merchant-safe message for any blocking preflight. */
export function preflightSummary(p: CandidatePreflight): string {
  if (p.candidate !== null && !p.isCurrent && p.verdict.safe) {
    return (
      "A newer version of this defence package exists. Refresh and review the " +
      "latest version before submitting."
    );
  }
  return packageBlockSummary(p.verdict);
}
