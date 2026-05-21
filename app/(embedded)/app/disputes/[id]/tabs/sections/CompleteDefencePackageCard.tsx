/**
 * CompleteDefencePackageCard — embedded ReviewSubmitTab section.
 *
 * Surfaces the Grounded Defence Package status: latest version, package
 * mode, validation result, generated/finalized/submitted timestamp, and
 * the controls to Preview / Regenerate / Finalize / Submit / Add manual
 * evidence.
 *
 * Hidden entirely when no defence_packages row exists for the pack (the
 * feature flag is off, or the auto-build hasn't run yet).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionList,
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Link,
  Popover,
  Spinner,
  Text,
} from "@shopify/polaris";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
} from "@/lib/defence/types";
import {
  DefencePackageHtmlView,
  type DisputeContextLike,
} from "./DefencePackageHtmlView";

type Status =
  | "draft"
  | "stale"
  | "final"
  | "submitted"
  | "superseded"
  | "failed"
  | "skipped";

interface DefencePackageRow {
  id: string;
  version: number;
  status: Status;
  package_mode: "full" | "narrow" | null;
  generated_at: string;
  generated_by: "system" | "merchant" | "admin";
  pdf_path: string | null;
  evidence_hash: string;
  llm_model: string | null;
  prompt_family: string | null;
  prompt_version: number | null;
  reason_code_module: string | null;
  validation_status: "ok" | "failed" | "skipped" | null;
  validation_errors: Array<{ section?: string; rule?: string; message?: string }>;
  failure_code: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  narrative_json: DefenceNarrativeOutput | null;
  facts_json: EvidenceFact[] | null;
}

/** Mirrors `PresentationStatus` from app/api/disputes/[id]/workspace/route.ts.
 *  Kept as a string literal union here to avoid a server-side import in
 *  this client component. */
export type PresentationStatusLike =
  | "DRAFT"
  | "SAVED_TO_SHOPIFY"
  | "AWAITING_SHOPIFY_AUTO_SUBMISSION"
  | "SUBMITTED_TO_NETWORK"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "CLOSED_UNKNOWN";

interface Props {
  packId: string | null;
  /** Used to render the inline HTML defence view + the days-remaining
   *  badge. Optional — when absent the card still works, just without
   *  the case-details / countdown enrichment. */
  dispute?: DisputeContextLike & { dueAt?: string | null };
  /** Pack-level submission timestamp (`evidence_packs.saved_to_shopify_at`).
   *  When set, the card switches to "Submitted to bank" state: the
   *  deadline countdown disappears, the Submit button is disabled, and
   *  an Open-in-Shopify link replaces it. */
  submittedToShopifyAt?: string | null;
  /** Direct deep-link to the dispute in Shopify Admin. Rendered as a
   *  Link in the submitted state. */
  shopifyAdminUrl?: string | null;
  /** Server-derived presentation status (workspace API). Drives the
   *  Regenerate gate after the card network has the evidence, and the
   *  outcome-expected countdown. Optional — when absent the card falls
   *  back to the pre-2026-05-20 behaviour driven only by
   *  `submittedToShopifyAt`. */
  presentationStatus?: PresentationStatusLike;
  /** Shopify's `evidenceSentOn` — the moment Shopify forwarded the
   *  evidence to the card network. Persisted as `disputes.submitted_at`.
   *  Drives the outcome-expected countdown. Optional. */
  evidenceSentOn?: string | null;
}

/** Days-remaining math, mirrors lib/disputeListHelpers getUrgency
 *  thresholds (≤48h = critical, ≤7d = warning). */
function daysRemainingFrom(dueAt: string | null | undefined): {
  label: string;
  tone: "critical" | "warning" | "info";
} | null {
  if (!dueAt) return null;
  const hoursLeft = (new Date(dueAt).getTime() - Date.now()) / (1000 * 60 * 60);
  if (Number.isNaN(hoursLeft)) return null;
  if (hoursLeft < 0) {
    return { label: "Deadline passed", tone: "critical" };
  }
  if (hoursLeft <= 24) {
    return { label: "Due today", tone: "critical" };
  }
  if (hoursLeft <= 48) {
    return { label: "Due in 1 day", tone: "critical" };
  }
  const days = Math.round(hoursLeft / 24);
  if (hoursLeft <= 168) {
    return { label: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: "warning" };
  }
  return { label: `Due in ${days} days`, tone: "info" };
}

/** Card-network review window — both Visa and Mastercard reserve up to
 *  ~45 days to post an outcome after evidence is forwarded. 30 days is
 *  the typical pragmatic median; we present it as "by [date]" without
 *  promising a guarantee. */
const NETWORK_REVIEW_WINDOW_DAYS = 30;

function outcomeExpectedFrom(evidenceSentOn: string | null | undefined): {
  label: string;
  isoDate: string;
} | null {
  if (!evidenceSentOn) return null;
  const sentAt = new Date(evidenceSentOn);
  if (Number.isNaN(sentAt.getTime())) return null;
  const expectedBy = new Date(sentAt.getTime() + NETWORK_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const label = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "long",
      }).format(expectedBy);
    } catch {
      return expectedBy.toISOString().slice(0, 10);
    }
  })();
  return { label, isoDate: expectedBy.toISOString() };
}

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "final" || status === "submitted"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "skipped" || status === "superseded"
          ? "subdued"
          : status === "stale"
            ? "warning"
            : "info";
  const label =
    status === "draft"
      ? "Draft"
      : status === "stale"
        ? "Stale"
        : status === "final"
          ? "Ready to submit"
          : status === "submitted"
            ? "Submitted"
            : status === "superseded"
              ? "Superseded"
              : status === "failed"
                ? "Validation failed"
                : "Skipped";
  return (
    <Text as="span" variant="bodySm" tone={tone === "subdued" ? "subdued" : undefined}>
      {label}
    </Text>
  );
}

export function CompleteDefencePackageCard({
  packId,
  dispute,
  submittedToShopifyAt,
  shopifyAdminUrl,
  presentationStatus,
  evidenceSentOn,
}: Props) {
  // Network-submitted: Shopify has forwarded the evidence to the card
  // network. Distinct from "saved to Shopify" — the bank now holds the
  // evidence and Shopify can no longer swap the saved PDF on the
  // dispute. Regenerate must be locked here.
  const isNetworkSubmitted = presentationStatus === "SUBMITTED_TO_NETWORK";
  // Closed: terminal outcome posted. Regenerate is meaningless after
  // the dispute has settled.
  const isClosed =
    presentationStatus === "CLOSED_WON" ||
    presentationStatus === "CLOSED_LOST" ||
    presentationStatus === "CLOSED_UNKNOWN";

  // Countdown is only relevant before submission — once the bank has
  // the package, "due in N days" stops being a useful state.
  const countdown = useMemo(
    () => (submittedToShopifyAt ? null : daysRemainingFrom(dispute?.dueAt)),
    [dispute?.dueAt, submittedToShopifyAt],
  );
  // Outcome-expected window: only meaningful when the card network has
  // the evidence. ~30 days from the moment Shopify forwarded.
  const outcomeExpected = useMemo(
    () => (isNetworkSubmitted ? outcomeExpectedFrom(evidenceSentOn) : null),
    [isNetworkSubmitted, evidenceSentOn],
  );
  const [latest, setLatest] = useState<DefencePackageRow | null>(null);
  const [bankFacing, setBankFacing] = useState<DefencePackageRow | null>(null);
  const [currentPromptVersion, setCurrentPromptVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"regen" | "finalize" | "submit" | null>(null);
  // "More actions" popover open/closed state. Holds Regenerate (a
  // less-common destructive action) so it doesn't sit visually equal
  // to the primary Approve / Resubmit buttons.
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!packId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/packs/${packId}/defence-packages`);
      if (!res.ok) {
        setError(`Could not load defence package (${res.status})`);
        setLatest(null);
        setBankFacing(null);
      } else {
        const json = (await res.json()) as {
          latest: DefencePackageRow | null;
          bankFacing?: DefencePackageRow | null;
          serverState?: { currentPromptVersion?: number | null };
        };
        setLatest(json.latest);
        setBankFacing(json.bankFacing ?? null);
        setCurrentPromptVersion(
          typeof json.serverState?.currentPromptVersion === "number"
            ? json.serverState.currentPromptVersion
            : null,
        );
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setLatest(null);
      setBankFacing(null);
    } finally {
      setLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Defence-in-depth: middleware injects `x-shop-id` from the
  // shopify_shop_id cookie for embedded requests, but we also pass
  // `?shop_id=` so the route works even on edges where the cookie
  // isn't readable (Safari ITP, brand-new install, server-render flows).
  const shopIdQs = dispute?.shopId ? `?shop_id=${encodeURIComponent(dispute.shopId)}` : "";

  const isSubmittedToBank = Boolean(submittedToShopifyAt);

  // The card distinguishes two rows:
  //   - `latest`:     the most recent version (what the merchant is
  //                   editing / about to submit).
  //   - `bankFacing`: the row whose PDF the bank actually has
  //                   (status=submitted). Set when isSubmittedToBank is
  //                   true and the workspace has been saved to Shopify;
  //                   otherwise null.
  //
  // `displayRow` is the row used by the inline HTML defence preview AND
  // the "Preview PDF" button on the Review & Submit tab. The priority
  // order matches the merchant's mental model on that tab — review
  // what you're about to send, not what you sent last time.
  //
  //   never submitted                → latest
  //   submitted, no newer draft      → bankFacing (= the only thing on file)
  //   submitted + newer unsubmitted  → latest   (the next outgoing PDF)
  //
  // Before 2026-05-19 this priority was bankFacing-first whenever
  // `isSubmittedToBank` was true. That rendered the v1 narrative under
  // the "Newer draft v5 ready to resubmit" banner — a confusing UX
  // because the prose the merchant saw was NOT the prose they were
  // about to send.
  //
  // Action buttons (Regenerate / Finalize / Submit) always operate on
  // `latest` (the work-in-progress draft) regardless of what's
  // rendered; the submission-state banner above the body still cites
  // `bankFacing.version` so "the bank has v1" stays accurate.
  const hasUnsubmittedDraft = Boolean(
    isSubmittedToBank &&
      bankFacing &&
      latest &&
      latest.id !== bankFacing.id,
  );
  const displayRow =
    hasUnsubmittedDraft && latest
      ? latest
      : isSubmittedToBank && bankFacing
        ? bankFacing
        : latest;

  // Preview URL is now a server-side redirect: the API route generates
  // the signed Supabase URL and 302s to it. Rendering as `<Button
  // url={previewHref} target="_blank">` keeps the open-in-new-tab inside
  // a real user-gesture context (a link click), instead of an async
  // window.open() from a fetch callback — which Shopify Admin's iframe
  // sandbox blocks.
  const previewHref = displayRow?.pdf_path
    ? `/api/defence-packages/${displayRow.id}/preview${shopIdQs}`
    : null;
  // Separate URL that always points at the bank-facing snapshot,
  // never the unsubmitted draft. Surfaces under "Submitted package"
  // as "View submitted vX PDF" so the merchant can verify what the
  // bank actually has independently of what they're about to send.
  const bankFacingHref =
    bankFacing && bankFacing.pdf_path
      ? `/api/defence-packages/${bankFacing.id}/preview${shopIdQs}`
      : null;

  const onRegenerate = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("regen");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/regenerate${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Regenerate failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

  const onFinalize = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("finalize");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/finalize${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Finalize failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

  const onSubmit = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("submit");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/submit${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Submit failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

  if (!packId) return null;
  if (loading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm">Complete Defence Package</Text>
          <Spinner accessibilityLabel="Loading defence package" size="small" />
        </BlockStack>
      </Card>
    );
  }
  // Feature flag off OR build hasn't run yet — hide the card entirely.
  if (!latest) return null;

  // `row` continues to drive metadata + action gates (status, validation,
  // generated_at, package_mode) — those are properties of the working
  // draft, not the bank-facing snapshot.
  const row = latest;
  // Action gates. The `!isSubmittedToBank` guard is dropped — the
  // status (`draft` / `final` / `stale` / `failed`) is the real
  // correctness check, and the "newer draft v2" flow needs Finalize +
  // Submit to be reachable after the v1 has been saved to Shopify.
  // The submit API enqueues a `save_to_shopify` job that replaces the
  // uncategorizedFile buffer (per Commit 10), so a second submit on
  // the same dispute swaps the PDF on the Shopify dispute cleanly.
  // To avoid surfacing the buttons on a clean "Submitted to bank"
  // view when nothing has changed, we further require that the merchant
  // has an actual draft pending — `hasUnsubmittedDraft` proves the
  // displayed `latest` row diverges from `bankFacing`.
  const hasActionableDraft = !isSubmittedToBank || hasUnsubmittedDraft;
  const canFinalize =
    hasActionableDraft &&
    row.status === "draft" &&
    row.validation_status === "ok" &&
    Boolean(row.pdf_path);
  const canSubmit = hasActionableDraft && row.status === "final";
  // Regenerate gate. The pre-submit cases (draft / stale / failed) are
  // always reachable. For a submitted row, only offer Regenerate when
  // it would actually produce something new — otherwise the merchant
  // clicks "Regenerate" and gets a v10 that's byte-identical to v9.
  //
  // "Something new" today means one of:
  //   - status === 'stale'  → underlying evidence drifted since this
  //                           draft was built. (Set by the enqueue
  //                           path when the evidence_hash changes.)
  //   - prompt_version lags → a code/prompt upgrade has shipped since
  //                           this draft was generated, so the next
  //                           regenerate picks up newer LLM guidance.
  //
  // Hard lock: once the card network has the evidence
  // (`presentationStatus === "SUBMITTED_TO_NETWORK"`) or the dispute is
  // closed, Regenerate is meaningless — Shopify can no longer swap the
  // forwarded PDF, and a draft would just sit unused. The lock fires
  // even if the prompt version has advanced.
  const submittedRowIsStale = row.status === "submitted" && (
    (latest?.status ?? null) === "stale" ||
    (typeof row.prompt_version === "number" &&
      typeof currentPromptVersion === "number" &&
      row.prompt_version < currentPromptVersion)
  );
  const canRegenerate =
    !isNetworkSubmitted &&
    !isClosed &&
    (row.status === "draft" ||
      row.status === "stale" ||
      row.status === "failed" ||
      submittedRowIsStale);

  const formattedSubmittedAt = submittedToShopifyAt
    ? (() => {
        try {
          return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(submittedToShopifyAt));
        } catch {
          return submittedToShopifyAt;
        }
      })()
    : null;

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingSm">Complete Defence Package</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              DisputeDesk prepares a bank-facing PDF that combines approved Shopify
              evidence, payment signals, fulfilment proof, customer communication,
              policies, and any merchant-supplied documents into one structured
              defence package.
            </Text>
          </BlockStack>

          {/* Workflow layout. Three states:
              A. Never submitted               → status / mode / deadline strip, then action row
              B. Submitted, no newer draft     → "Submitted package" panel only
              C. Submitted + newer draft       → "Submitted package" panel + "New draft" panel
              See the action row further down for the matching button hierarchy. */}
          {isSubmittedToBank ? (
            <BlockStack gap="300">
              {/* Section A — Submitted package. Title + body adapt to
                  the real network state when presentationStatus is
                  available:
                    - SUBMITTED_TO_NETWORK → "Forwarded to card network"
                    - SAVED_TO_SHOPIFY / AWAITING_AUTO_SUBMISSION →
                      "Saved to Shopify (awaiting forwarding)"
                    - CLOSED_* → "Outcome posted"
                  When presentationStatus is absent (legacy mount), the
                  copy falls back to the pre-2026-05-20 "Submitted
                  package" phrasing. */}
              <Banner
                tone="success"
                title={
                  isClosed
                    ? "Outcome posted"
                    : isNetworkSubmitted
                      ? "Forwarded to the card network"
                      : "Saved to Shopify"
                }
              >
                <BlockStack gap="100">
                  {bankFacing ? (
                    <Text as="p" variant="bodySm">
                      {isNetworkSubmitted
                        ? `Defence package v${bankFacing.version} has been forwarded by Shopify to the card network${formattedSubmittedAt ? `. Saved to Shopify on ${formattedSubmittedAt}.` : "."} The card network's decision is final once posted — Shopify can no longer swap the forwarded PDF.`
                        : isClosed
                          ? `Defence package v${bankFacing.version} was submitted${formattedSubmittedAt ? ` on ${formattedSubmittedAt}` : ""}. The dispute has been closed by the card network.`
                          : `Defence package v${bankFacing.version} is saved to Shopify${formattedSubmittedAt ? ` (${formattedSubmittedAt})` : ""}. Shopify has not yet forwarded it to the card network — if you regenerate, the new PDF will replace this saved version cleanly.`}
                    </Text>
                  ) : (
                    <Text as="p" variant="bodySm">
                      A defence package has been submitted to the bank.
                    </Text>
                  )}
                  <InlineStack gap="200" blockAlign="center">
                    {bankFacingHref && bankFacing ? (
                      <Link url={bankFacingHref} external>
                        View submitted v{bankFacing.version} PDF
                      </Link>
                    ) : null}
                    {shopifyAdminUrl ? (
                      <Link url={shopifyAdminUrl} external>
                        Open in Shopify Admin
                      </Link>
                    ) : null}
                  </InlineStack>
                </BlockStack>
              </Banner>

              {/* Outcome-expected countdown — only when the card
                  network has the evidence. Sets expectation without
                  promising the network's exact turnaround. */}
              {outcomeExpected ? (
                <Banner tone="info" title="Card network reviewing">
                  <Text as="p" variant="bodySm">
                    Visa and Mastercard typically post an outcome within
                    {" "}{NETWORK_REVIEW_WINDOW_DAYS} days of forwarding. Expect a
                    decision around <strong>{outcomeExpected.label}</strong>.
                    DisputeDesk will update this card as soon as the
                    outcome arrives.
                  </Text>
                </Banner>
              ) : null}

              {/* Section B — New draft available. Suppressed when the
                  card network already has the evidence (regenerating is
                  meaningless: Shopify can't replace the forwarded PDF)
                  or when the dispute has closed. */}
              {hasUnsubmittedDraft && latest && bankFacing && !isNetworkSubmitted && !isClosed ? (
                <Banner tone="info" title={`Draft v${latest.version} is ready for review`}>
                  <Text as="p" variant="bodySm">
                    Draft v{latest.version} has been generated but has not
                    been sent to Shopify yet. Review it below.{" "}
                    {latest.status === "draft"
                      ? `If it looks correct, approve v${latest.version} before resubmitting to Shopify.`
                      : `If it looks correct, resubmit it to Shopify — that will replace v${bankFacing.version}.`}
                  </Text>
                </Banner>
              ) : null}
            </BlockStack>
          ) : (
            <InlineStack gap="400" align="space-between">
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                <StatusBadge status={row.status} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Mode</Text>
                <Text as="span" variant="bodySm">{row.package_mode ?? "—"}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Generated</Text>
                <Text as="span" variant="bodySm">
                  {new Date(row.generated_at).toLocaleString()}
                </Text>
              </BlockStack>
              {countdown && (
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">Deadline</Text>
                  <Badge tone={countdown.tone === "info" ? undefined : countdown.tone}>
                    {countdown.label}
                  </Badge>
                </BlockStack>
              )}
            </InlineStack>
          )}

          {row.status === "skipped" && row.failure_code === "covered_shopify" && (
            <Banner tone="info" title="Covered by Shopify Protect">
              <p>
                This dispute is covered by Shopify Protect. No bank-facing defence
                package is required.
              </p>
            </Banner>
          )}

          {row.status === "skipped" && row.failure_code === "no_bank_eligible_facts" && (
            <Banner tone="warning" title="Not enough bank-facing evidence">
              <p>
                The classifier did not find any bank-eligible approved facts for
                this dispute. Upload additional supporting documents or wait for
                the next sync to include freshly collected evidence.
              </p>
            </Banner>
          )}

          {row.status === "failed" && (
            <Banner tone="critical" title="Validation failed">
              <BlockStack gap="200">
                <p>{row.failure_reason ?? "Validation found unsupported claims in the generated narrative."}</p>
                {row.validation_errors?.length > 0 && (
                  <ul style={{ marginLeft: 16, fontSize: 12 }}>
                    {row.validation_errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e.message ?? e.rule}</li>
                    ))}
                  </ul>
                )}
              </BlockStack>
            </Banner>
          )}

          {/* Stale-vs-regenerating split: the same `stale` status applies
              whether the merchant hasn't acted yet OR they just clicked
              Regenerate and the build chain is still running. The original
              copy ("Regenerate to refresh") was useless in the latter case
              — they'd already clicked. We now distinguish the two:
                - busy === "regen" → just-clicked, show progress copy
                - status === "stale" without busy → action prompt
              Once buildDefencePackageJob finishes, `latest` becomes the new
              `draft` v2 and `row.status` is no longer "stale", so this whole
              block stops rendering. */}
          {row.status === "stale" && busy === "regen" && (
            <Banner tone="info" title="Building your new defence package…">
              <p>
                We&rsquo;re rebuilding the evidence pack and drafting a fresh
                narrative + PDF based on the latest data. This usually takes
                2&ndash;3 minutes. The page will update automatically when
                the new version is ready — feel free to keep this tab open
                or come back later.
              </p>
            </Banner>
          )}
          {row.status === "stale" && busy !== "regen" && (
            <Banner tone="warning" title="New evidence available — refresh this draft">
              <p>
                Recent updates (uploads, status changes, or new auto-collected
                signals) aren&rsquo;t reflected in this draft yet. Click
                Regenerate below to build a new version that includes them
                — the rebuild takes 2&ndash;3 minutes and runs in the
                background.
              </p>
            </Banner>
          )}

          {/* Action row — one primary at a time, plain-language labels,
              Regenerate demoted to a "More actions" overflow.
              Merchant-facing workflow:
                  Review draft  →  Approve  →  Resubmit to Shopify
              The labels intentionally avoid lifecycle jargon
              ("Finalize") because non-technical merchants ask "finalize
              what?" Approve communicates the action clearly.
              See the brief in commit message for the full rationale. */}
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <ButtonGroup>
              {/* PRIMARY: the next step in the workflow, exactly one
                  button at a time.
                    - Draft awaiting approval → "Approve draft vX"
                    - Final awaiting submit  → "Submit to Shopify" /
                                                "Resubmit to Shopify"
                    - Neither (e.g. already submitted, no newer
                      draft) → no primary button. */}
              {canFinalize && latest && (
                <Button
                  variant="primary"
                  onClick={onFinalize}
                  disabled={busy !== null}
                  loading={busy === "finalize"}
                >
                  {isSubmittedToBank
                    ? `Approve draft v${latest.version}`
                    : `Approve v${latest.version}`}
                </Button>
              )}
              {canSubmit && !canFinalize && (
                <Button
                  variant="primary"
                  tone="success"
                  onClick={onSubmit}
                  disabled={busy !== null}
                  loading={busy === "submit"}
                >
                  {isSubmittedToBank
                    ? "Resubmit to Shopify"
                    : "Submit to Shopify"}
                </Button>
              )}

              {/* SECONDARY: review the draft the merchant is about to
                  approve / submit. previewHref tracks displayRow which
                  now follows the latest-first priority — so this
                  always opens the version the merchant is reading
                  inline below. */}
              <Button
                url={previewHref ?? undefined}
                target="_blank"
                external
                disabled={!previewHref || busy !== null}
              >
                {hasUnsubmittedDraft && latest
                  ? `Review draft v${latest.version} PDF`
                  : "View PDF"}
              </Button>
            </ButtonGroup>

            {/* TERTIARY (overflow): Regenerate. Hidden behind "More
                actions" because it's a less-common, destructive
                action (throws away the current draft). Lives in a
                popover so it can't be misclicked as the primary
                action.

                Only renders when canRegenerate is true (matches the
                existing gate — draft / stale / failed status). */}
            {canRegenerate && (
              <Popover
                active={moreActionsOpen}
                onClose={() => setMoreActionsOpen(false)}
                activator={
                  <Button
                    onClick={() => setMoreActionsOpen((v) => !v)}
                    disclosure
                    disabled={busy !== null}
                  >
                    More actions
                  </Button>
                }
              >
                <ActionList
                  items={[
                    {
                      content:
                        busy === "regen"
                          ? "Regenerating…"
                          : "Regenerate draft from scratch",
                      helpText:
                        "Throws away the current draft and rebuilds the narrative + PDF against the latest evidence. The bank-facing submitted version is not touched.",
                      onAction: () => {
                        setMoreActionsOpen(false);
                        void onRegenerate();
                      },
                      disabled: busy !== null,
                    },
                  ]}
                />
              </Popover>
            )}
          </InlineStack>

          {error && (
            <Banner tone="warning" title="Could not load defence package">
              <p>{error}</p>
            </Banner>
          )}
        </BlockStack>
      </Card>

      {/* Inline HTML defence view — visually mirrors the PDF document
          section-for-section. Hidden when the package has no narrative
          (skipped / failed rows).

          Renders `displayRow` (see priority in the comment block where
          displayRow is computed). When a newer unsubmitted draft
          exists alongside a submitted bank-facing row, a clear banner
          ABOVE the preview names which version the merchant is
          reading so they can't conflate v5's clean prose with v1's
          stale prose. */}
      {hasUnsubmittedDraft && latest && bankFacing ? (
        <Banner
          tone="info"
          title={`You are reviewing draft v${latest.version}`}
        >
          <p>
            This is the version that will replace v{bankFacing.version} if
            you resubmit. The bank currently has v{bankFacing.version}.
          </p>
        </Banner>
      ) : null}
      {displayRow?.narrative_json && displayRow?.facts_json && (
        <DefencePackageHtmlView row={displayRow} dispute={dispute} />
      )}
    </>
  );
}
