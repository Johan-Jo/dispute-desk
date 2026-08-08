/**
 * Canonical AVS code map — normalization per (network, code). (PR-C3 / C-13)
 *
 * WHAT THIS REPLACES. PR-C2 gave AVS and CVV one owner but kept ONE flat,
 * network-agnostic match set (`Y A W X D M`) carried over from before the
 * split. That set is broader than the only rule we can source: register
 * **R-E**, Visa §4 Compelling Evidence chart Item 3 — *"evidence that the item
 * was delivered to the same physical address for which the Merchant received
 * an **AVS match of Y or M**"*. So a `W` (postal-only) result was being cited
 * under a rule that names `Y` or `M` specifically.
 *
 * TWO SEPARATE QUESTIONS, TWO SEPARATE ANSWERS. This module answers the first
 * and only the first:
 *
 *   1. WHAT DID THE ISSUER SAY?  → `AvsNormalizedResult`, a factual reading of
 *      the response. Drives merchant copy, internal scoring inputs and
 *      diagnostics. Deliberately broad.
 *   2. MAY WE CITE IT?           → `ceItem3Citable`, true only for the
 *      primary-sourced codes. Deliberately narrow (decision 3).
 *
 * Conflating them is how a postal-code match ended up standing in for a rule
 * about the delivery address.
 *
 * AUTHORITY IS RECORDED PER CELL, NOT ASSUMED. Every entry carries an
 * `authority` state in the vocabulary of `docs/evidence-model/p0/primary-source-register.md`:
 * `v_primary` (quoted from the network's own document), `v_secondary`, or
 * `unverified` (the gateway convention this codebase has always used, never
 * checked against a network table). **An `unverified` cell is never citable.**
 * That is the register's exit rule applied to code semantics: unsourced means
 * internal-only, not "probably fine".
 *
 * WHAT IS NOT SOURCED YET, stated plainly rather than papered over: we hold no
 * primary Mastercard or Amex AVS code table. Their entries below are the same
 * gateway convention marked `unverified`, and the per-network override maps
 * exist and are EMPTY — the structure is keyed on (network, code) so a sourced
 * table drops in without touching a consumer, but nothing here pretends to
 * know a network-specific meaning it cannot quote.
 *
 * ALSO NOT DECIDED HERE: whether citation should additionally require the
 * network to BE Visa. Decision 3 is scoped to codes (`Y`/`M`), not networks,
 * and 20 of the 44 citable packs on prod are Mastercard, Amex, or carry no
 * network at all. Narrowing by network is a separate decision with its own
 * measured delta — see the PR body.
 */

/* ── Vocabularies ──────────────────────────────────────────────────────── */

export type CardNetwork = "visa" | "mastercard" | "amex" | "unknown";

/**
 * What the issuer's AVS response says, factually.
 *
 * `no_match` means **at least one component definitively failed**. That
 * includes `Z` (postal matched, street failed): the merchant view is
 * deliberately coarse — any failing component reads as "did not match"
 * (2026-07-23 directive) — and the scorer has always treated `Z` as a
 * non-match. Calling it `postal_match` here would quietly promote a code the
 * whole system treats as a failure. `postal_match` is reserved for `W`, where
 * the postal code matched and the street was not asserted against.
 */
export type AvsNormalizedResult =
  | "full_match"
  | "street_match"
  | "postal_match"
  | "no_match"
  | "not_checked"
  | "unavailable"
  | "unknown";

/** Verification state of the cell, per `p0/primary-source-register.md`. */
export type AvsAuthority = "v_primary" | "v_secondary" | "unverified";

export interface AvsCell {
  result: AvsNormalizedResult;
  authority: AvsAuthority;
  /** True only for a code the CE chart Item 3 rule names (register R-E). */
  ceItem3Citable: boolean;
  /** Why the cell reads the way it does. Audit-log friendly. */
  note: string;
}

/**
 * The codes register R-E names. **The citation set, and the only cells that
 * may carry `v_primary`.**
 *
 * `M` here is an AVS response, not the CVV match code that shares the letter.
 */
const CE_ITEM_3_CODES = new Set(["Y", "M"]);

/* ── The shared base table ─────────────────────────────────────────────── */

/**
 * The gateway convention this codebase has used since before the canonical
 * model existed: matches `Y A W X D M`, definite failures `Z N C`, everything
 * else not verified. Encoded once, marked `unverified` except where R-E
 * speaks, and inherited by every network.
 *
 * Codes NOT listed are deliberately absent. An unlisted code resolves to
 * `unknown` and earns no credit anywhere — see `normalizeAvsCode`. Guessing at
 * `B`, `F`, `P` and the rest of the international space without a network
 * document is exactly the drift this series exists to remove; PR-C2 pinned one
 * such guess (`F` read as a match while scoring credited nothing) and this
 * table is where it is resolved: conservatively, by omission.
 */
const BASE_AVS_TABLE: Record<string, AvsCell> = {
  Y: {
    result: "full_match",
    authority: "v_primary",
    ceItem3Citable: true,
    note: "Street address and postal code both matched. Named by register R-E (Visa §4 CE chart Item 3) as a qualifying AVS match.",
  },
  M: {
    result: "full_match",
    authority: "v_primary",
    ceItem3Citable: true,
    note: "International address match. The second code register R-E names.",
  },
  X: {
    result: "full_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Full match (international, 9-digit postal). Gateway convention; not named by R-E, so internal only.",
  },
  D: {
    result: "full_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "International address match per gateway convention; not named by R-E, so internal only.",
  },
  A: {
    result: "street_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Street matched, postal code did not. A partial address result; R-E names neither.",
  },
  W: {
    result: "postal_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Postal code matched, street not asserted. A partial address result; R-E names neither.",
  },
  Z: {
    result: "no_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Postal code matched, street DID NOT. A component failed, so it reads as a non-match on every surface — as it always has.",
  },
  N: {
    result: "no_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Neither street nor postal code matched.",
  },
  C: {
    result: "no_match",
    authority: "unverified",
    ceItem3Citable: false,
    note: "International: neither component matched.",
  },
  U: {
    result: "unavailable",
    authority: "unverified",
    ceItem3Citable: false,
    note: "The issuer did not supply a result. Absence of verification is never a negative signal.",
  },
  S: {
    result: "not_checked",
    authority: "unverified",
    ceItem3Citable: false,
    note: "The issuer does not support AVS.",
  },
  R: {
    result: "unavailable",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Retry — the issuer's system was unavailable at authorization.",
  },
  G: {
    result: "not_checked",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Non-participating international issuer; address not verified.",
  },
  E: {
    result: "unavailable",
    authority: "unverified",
    ceItem3Citable: false,
    note: "Error or AVS not applicable to this transaction type.",
  },
};

/**
 * Per-network overrides, applied on top of the base table.
 *
 * EMPTY BY DESIGN, and that is the finding, not an omission: we hold no
 * primary Mastercard or Amex AVS code table, so there is nothing here that
 * could be quoted. When one is extracted, its cells land here with
 * `authority: "v_primary"` and the base entry stops applying for that network
 * — no consumer changes. The Visa entry is empty for the same reason: R-E
 * gives us the CE **citation** rule, which the base table already encodes; it
 * does not give us Visa's full response-code table.
 */
const NETWORK_OVERRIDES: Record<CardNetwork, Record<string, AvsCell>> = {
  visa: {},
  mastercard: {},
  amex: {},
  unknown: {},
};

/** The cell for an unlisted code. Conservative on every axis. */
const UNMAPPED_CELL: AvsCell = {
  result: "unknown",
  authority: "unverified",
  ceItem3Citable: false,
  note: "Code not present in the canonical map. Recorded as an internal diagnostic; earns no grade, no citation and no completeness credit, and never asserts anything against the cardholder.",
};

/* ── Resolution ────────────────────────────────────────────────────────── */

/**
 * The card network for a payment payload, from the brand the gateway
 * reported (`cardCompany`, or `company` / `cardBrand` on older shapes).
 *
 * Returns `unknown` rather than guessing. On prod, 19 of 130 AVS-bearing
 * packs carry no brand at all — an unknown network must therefore be a
 * first-class, non-punitive state: it selects the base table, and citation
 * still turns on the CODE, per decision 3.
 */
export function resolveCardNetwork(payload: unknown): CardNetwork {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const raw =
    (typeof p.cardCompany === "string" && p.cardCompany) ||
    (typeof p.company === "string" && p.company) ||
    (typeof p.cardBrand === "string" && p.cardBrand) ||
    "";
  const normalized = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!normalized) return "unknown";
  if (normalized.includes("visa")) return "visa";
  if (normalized.includes("mastercard") || normalized.includes("master card")) return "mastercard";
  if (normalized.includes("american express") || normalized === "amex") return "amex";
  return "unknown";
}

export interface NormalizedAvs extends AvsCell {
  /** Upper-cased code, or null when the gateway returned none. */
  code: string | null;
  network: CardNetwork;
  /** True when a code was returned but the map has no entry for it. */
  unmapped: boolean;
}

/** The cell for an absent code. Absence is never a signal. */
const ABSENT: Omit<NormalizedAvs, "network"> = {
  code: null,
  result: "not_checked",
  authority: "unverified",
  ceItem3Citable: false,
  unmapped: false,
  note: "No AVS result on the transaction. Never a negative signal.",
};

/**
 * Normalize one AVS response. Pure, total, and conservative for everything it
 * does not recognise.
 */
export function normalizeAvsCode(
  network: CardNetwork,
  rawCode: string | null | undefined,
): NormalizedAvs {
  const code =
    typeof rawCode === "string" && rawCode.trim().length > 0
      ? rawCode.trim().toUpperCase()
      : null;

  if (code === null) return { ...ABSENT, network };

  const cell = NETWORK_OVERRIDES[network]?.[code] ?? BASE_AVS_TABLE[code] ?? null;
  if (!cell) return { ...UNMAPPED_CELL, code, network, unmapped: true };

  return { ...cell, code, network, unmapped: false };
}

/**
 * Does this normalized result count as an address match for SCORING and
 * merchant display? The three match flavours — and only those.
 *
 * Exactly the pre-PR-C3 set (`Y A W X D M`), now derived from the table
 * instead of restated as a literal, so the descriptive reading and the
 * scoring reading can no longer disagree.
 */
export function isAddressMatchResult(result: AvsNormalizedResult): boolean {
  return result === "full_match" || result === "street_match" || result === "postal_match";
}

/** The primary-sourced citation set, exposed for tests and for the invariant
 *  that no broader set reaches a citation. */
export function isCeItem3Code(code: string | null): boolean {
  return code !== null && CE_ITEM_3_CODES.has(code);
}
