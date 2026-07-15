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
import { useTranslations } from "next-intl";
import {
  ActionList,
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  InlineStack,
  Popover,
  Spinner,
  Text,
} from "@shopify/polaris";
import type { CSSProperties } from "react";
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

export interface DefencePackageRow {
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
   *  Button in the submitted state. */
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
  /** Fires after a successful Submit/Finalize POST. Lets the parent
   *  workspace flip its `justSubmitted` flag and re-fetch the workspace
   *  endpoint immediately, so the card re-renders against fresh data
   *  instead of the stale snapshot it had before the POST. Without this
   *  the merchant sees the page snap back to "Submit to Shopify" and
   *  thinks the click did nothing — the save-to-shopify job runs
   *  asynchronously and may take 5–30s to stamp `saved_to_shopify_at`. */
  onSubmitted?: () => void;
  /** Defence package rows lifted from the workspace endpoint. The
   *  card no longer owns its own fetch — switching tabs used to
   *  unmount/remount this component, which re-paid the round-trip on
   *  every visit and made the Review & Submit tab feel slow. Both
   *  rows are kept fresh by the workspace hook's 4s poll. */
  defencePackage?: {
    latest: DefencePackageRow | null;
    bankFacing: DefencePackageRow | null;
    currentPromptVersion: number | null;
  };
  /** Triggers a workspace refresh. Bound to the parent's
   *  `actions.fetchAll`. Used by the "Check for update" action on the
   *  "Building new package" banner and after Regenerate / Finalize /
   *  Submit POSTs so the card re-renders against fresh data. */
  onRefresh?: () => void | Promise<void>;
}

/** Days-remaining math, mirrors lib/disputeListHelpers getUrgency
 *  thresholds (≤48h = critical, ≤7d = warning). */
function daysRemainingFrom(
  dueAt: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): {
  label: string;
  tone: "critical" | "warning" | "info";
} | null {
  if (!dueAt) return null;
  const hoursLeft = (new Date(dueAt).getTime() - Date.now()) / (1000 * 60 * 60);
  if (Number.isNaN(hoursLeft)) return null;
  if (hoursLeft < 0) {
    return { label: t("deadlinePassed"), tone: "critical" };
  }
  if (hoursLeft <= 24) {
    return { label: t("dueToday"), tone: "critical" };
  }
  if (hoursLeft <= 48) {
    return { label: t("dueInOneDay"), tone: "critical" };
  }
  const days = Math.round(hoursLeft / 24);
  if (hoursLeft <= 168) {
    return { label: t("dueInNDays", { days }), tone: "warning" };
  }
  return { label: t("dueInNDays", { days }), tone: "info" };
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
  const tPkg = useTranslations("disputes.reviewTab.package");
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
      ? tPkg("statusLabels.draft")
      : status === "stale"
        ? tPkg("statusLabels.stale")
        : status === "final"
          ? tPkg("statusLabels.ready")
          : status === "submitted"
            ? tPkg("statusLabels.submitted")
            : status === "superseded"
              ? tPkg("statusLabels.superseded")
              : status === "failed"
                ? tPkg("statusLabels.validationFailed")
                : tPkg("statusLabels.skipped");
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
  onSubmitted,
  defencePackage,
  onRefresh,
}: Props) {
  const t = useTranslations("disputes.completeDefencePackage");
  const tPkg = useTranslations("disputes.reviewTab.package");
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
    () => (submittedToShopifyAt ? null : daysRemainingFrom(dispute?.dueAt, t)),
    [dispute?.dueAt, submittedToShopifyAt],
  );
  // Outcome-expected window: only meaningful when the card network has
  // the evidence. ~30 days from the moment Shopify forwarded.
  const outcomeExpected = useMemo(
    () => (isNetworkSubmitted ? outcomeExpectedFrom(evidenceSentOn) : null),
    [isNetworkSubmitted, evidenceSentOn],
  );
  // Defence package rows come from the workspace endpoint (lifted up
  // 2026-05-25). Pre-lift, this card owned its own fetch and re-paid
  // a round-trip every time the merchant switched to Review & Submit.
  // Now switching tabs is instant — the data is already in memory and
  // the workspace's 4s poll keeps it fresh.
  //
  // The card hasn't received its first defencePackage update yet when
  // `defencePackage === undefined`. That's only true on the very first
  // workspace fetch before any payload arrives — we treat it like the
  // pre-2026-05-25 "loading" state.
  const latest = defencePackage?.latest ?? null;
  const bankFacing = defencePackage?.bankFacing ?? null;
  const currentPromptVersion = defencePackage?.currentPromptVersion ?? null;
  const loading = defencePackage === undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"regen" | "finalize" | "submit" | null>(null);
  // Manual-refresh in-flight state for the "Check for update" action on
  // the "Building new package" banner. Tracks the parent's `onRefresh`
  // promise so the button shows a spinner during the refetch.
  const [refreshing, setRefreshing] = useState(false);
  // True between a successful submit POST (job enqueued) and the moment
  // the parent passes a real `submittedToShopifyAt` (job ran and stamped
  // `evidence_packs.saved_to_shopify_at`). During this gap the parent's
  // optimistic timestamp comes from `useReviewView`'s `new Date()`
  // fallback, so `isSubmittedToBank` is true but the bank doesn't
  // actually have the package yet. Drives a "Saving to Shopify…" banner
  // override so we don't claim "Saved" before the job persists.
  const [submitPending, setSubmitPending] = useState(false);
  // "More actions" popover open/closed state. Holds Regenerate (a
  // less-common destructive action) so it doesn't sit visually equal
  // to the primary Approve / Resubmit buttons.
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);

  // Tracks "regenerate has been requested, the rebuild is in flight
  // server-side but no new draft row exists yet." Separate from `busy`
  // (which only tracks the *HTTP request* to /regenerate — that returns
  // in ms once the job is enqueued, long before the actual rebuild
  // finishes 2-3 min later).
  //
  // Without this state, the warning banner ("Click Regenerate below")
  // re-appears the instant the POST returns — confusing UX because the
  // merchant already clicked Regenerate and is now told to click it
  // again. Persisted in sessionStorage (keyed by packId) so a page
  // reload mid-rebuild doesn't drop the in-progress state.
  //
  // Shape: { fromVersion: number, requestedAt: number }
  //   - fromVersion: the latest.version at the time the user clicked.
  //     The build is done when `latest.version > fromVersion`.
  //   - requestedAt: epoch ms — used to time out the banner after
  //     REBUILD_TIMEOUT_MS in case the job genuinely fails and no new
  //     version ever lands. Without the cap the banner would lie forever.
  const [pendingRegen, setPendingRegen] = useState<{
    fromVersion: number;
    requestedAt: number;
  } | null>(null);

  const pendingRegenStorageKey = useMemo(
    () => (packId ? `dd:pendingRegen:${packId}` : null),
    [packId],
  );

  // Hydrate from sessionStorage on mount so a tab reload during the
  // 2-3 min rebuild window keeps showing "Building…" instead of
  // snapping back to the "click Regenerate" warning.
  useEffect(() => {
    if (!pendingRegenStorageKey) return;
    try {
      const raw = window.sessionStorage.getItem(pendingRegenStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        fromVersion?: unknown;
        requestedAt?: unknown;
      };
      if (
        typeof parsed.fromVersion === "number" &&
        typeof parsed.requestedAt === "number"
      ) {
        setPendingRegen({
          fromVersion: parsed.fromVersion,
          requestedAt: parsed.requestedAt,
        });
      }
    } catch {
      // sessionStorage unavailable (SSR / private mode) — silently skip.
    }
  }, [pendingRegenStorageKey]);

  // Manual refresh trigger for explicit "Check for update" presses on
  // the "Building new package" banner. Delegates to the parent's
  // `onRefresh` (= `actions.fetchAll`), which re-fetches the workspace
  // endpoint and re-populates `defencePackage` via props. Pre-lift this
  // ran a card-local `load()`; the parent's refetch covers it now.
  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  // Clear the pendingRegen flag once a new defence_packages row
  // (higher version) arrives via the workspace poll. Pre-lift this
  // lived inside `load()`; now that the card no longer owns fetching,
  // the cleanup runs as a side-effect of latest.version changing.
  useEffect(() => {
    if (!latest || !pendingRegenStorageKey) return;
    setPendingRegen((current) => {
      if (current && latest.version > current.fromVersion) {
        try {
          window.sessionStorage.removeItem(pendingRegenStorageKey);
        } catch {
          // sessionStorage unavailable — ignore.
        }
        return null;
      }
      return current;
    });
  }, [latest?.version, pendingRegenStorageKey]);

  // Clear the optimistic "Saving to Shopify…" banner once the
  // save-to-shopify job has completed: that's when the latest
  // defence_packages row flips to status='submitted' (set in the same
  // transaction that stamps `evidence_packs.saved_to_shopify_at`).
  // Without this, the banner would stay forever even after the bank
  // has the package.
  useEffect(() => {
    if (submitPending && latest?.status === "submitted") {
      setSubmitPending(false);
    }
  }, [submitPending, latest?.status]);

  // Safety net: if the save-to-shopify job never finishes (worker
  // down, network errors, etc.) the optimistic banner would otherwise
  // pretend submission is in flight forever. Cap at 90s, then fall
  // back to whatever the workspace data says. The merchant can retry
  // from the now-uncovered Submit/Resubmit button.
  useEffect(() => {
    if (!submitPending) return;
    const t = window.setTimeout(() => setSubmitPending(false), 90_000);
    return () => window.clearTimeout(t);
  }, [submitPending]);

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
  // Demo exception: the public demo (shopId === "demo") has no real
  // defence_packages row and the preview route 401s on demo shop
  // context — and a link navigation bypasses the demo fetch shim, which
  // only wraps window.fetch. The demo fixture stores a static sample
  // PDF path under /public, so link to it directly.
  const previewHref = displayRow?.pdf_path
    ? dispute?.shopId === "demo"
      ? displayRow.pdf_path
      : `/api/defence-packages/${displayRow.id}/preview${shopIdQs}`
    : null;

  /** True when the merchant clicked Regenerate AND no newer-version
   *  draft has landed yet. Drives the "Building…" banner. We also cap
   *  this at 15 minutes since requestedAt — if the rebuild genuinely
   *  fails the banner gracefully falls back to the warning copy
   *  instead of lying forever. Normal rebuild time is 2-3 min, so
   *  15 min is a comfortable ceiling. The local `busy === "regen"`
   *  flag (HTTP-request-in-flight) is also OR-ed in so we don't have
   *  a one-tick gap between the POST resolving and pendingRegen being
   *  set. */
  const REBUILD_TIMEOUT_MS = 15 * 60 * 1000;
  const rebuildInFlight =
    busy === "regen" ||
    (pendingRegen !== null &&
      Date.now() - pendingRegen.requestedAt < REBUILD_TIMEOUT_MS);

  const onRegenerate = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("regen");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/regenerate${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(tPkg("errors.regenerateFailed", { status: res.status }));
        return;
      }
      // Capture the version we just kicked off a rebuild for. The
      // "Building…" banner stays visible until `latest.version` exceeds
      // this — i.e. until the new draft row lands. Persist in
      // sessionStorage so a page reload mid-rebuild doesn't drop the
      // in-progress state.
      const pending = {
        fromVersion: latest.version,
        requestedAt: Date.now(),
      };
      setPendingRegen(pending);
      if (pendingRegenStorageKey) {
        try {
          window.sessionStorage.setItem(
            pendingRegenStorageKey,
            JSON.stringify(pending),
          );
        } catch {
          // sessionStorage unavailable — banner still works for this
          // tab via the in-memory state.
        }
      }
      await onRefresh?.();
    } finally {
      setBusy(null);
    }
  }, [latest, onRefresh, shopIdQs, pendingRegenStorageKey, tPkg]);

  const onFinalize = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("finalize");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/finalize${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        let detail = tPkg("errors.finalizeFailed", { status: res.status });
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") detail = body.error;
        } catch {
          // Non-JSON body — keep the fallback.
        }
        setError(detail);
      }
      await onRefresh?.();
    } finally {
      setBusy(null);
    }
  }, [latest, onRefresh, shopIdQs, tPkg]);

  const onSubmit = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("submit");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/submit${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        // Surface the route's structured error message when present so
        // the merchant sees "Cannot submit a package in status=draft"
        // instead of an opaque HTTP code. Falls back to the bare status.
        let detail = tPkg("errors.submitFailed", { status: res.status });
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") detail = body.error;
        } catch {
          // Non-JSON body — keep the fallback.
        }
        setError(detail);
        return;
      }
      // POST accepted: the save-to-shopify job is enqueued but won't
      // have run yet. Notify the parent so it flips justSubmitted (which
      // drives derived.isReadOnly → useReviewView state="submitted" →
      // this card re-renders into the "Saved to Shopify" layout) AND
      // kicks an immediate workspace fetch. The hook's 4s poll then
      // replaces the placeholder timestamp with the real
      // `saved_to_shopify_at` once the job persists.
      setSubmitPending(true);
      onSubmitted?.();
      await onRefresh?.();
    } finally {
      setBusy(null);
    }
  }, [latest, onRefresh, onSubmitted, shopIdQs, tPkg]);

  if (!packId) return null;
  if (loading) {
    return (
      <div style={DEFENCE_CARD_STYLE}>
        <BlockStack gap="300">
          <h2 style={CARD_TITLE_STYLE}>{t("headingMain")}</h2>
          <Spinner accessibilityLabel={tPkg("loadingAccessibilityLabel")} size="small" />
        </BlockStack>
      </div>
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

  // True when the "Draft vX is ready for review" banner is going to
  // render — that banner now hosts Approve / Resubmit / More actions
  // so the merchant doesn't bounce between the banner and a detached
  // action row below the inline preview. The same expression gates
  // the banner itself a few lines down; precomputing it here lets the
  // lower action row suppress duplicates cleanly.
  const bannerHostsActions =
    hasUnsubmittedDraft &&
    !!latest &&
    !!bankFacing &&
    !isNetworkSubmitted &&
    !isClosed &&
    !submitPending;

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
      <div style={DEFENCE_CARD_STYLE}>
        <BlockStack gap="400">
          <div>
            <h2 style={CARD_TITLE_STYLE}>{t("headingMain")}</h2>
            <p style={CARD_HELP_STYLE}>
              {tPkg.rich("cardHelp", {
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>

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
              {submitPending ? (
                <Banner tone="info" title={t("savingTitle")}>
                  <Text as="p" variant="bodySm">
                    {tPkg("savingBody")}
                  </Text>
                </Banner>
              ) : (
                <SavedToShopifyPackageBanner
                  title={
                    isClosed
                      ? tPkg("savedTitles.outcomePosted")
                      : isNetworkSubmitted
                        ? tPkg("savedTitles.forwardedToNetwork")
                        : tPkg("savedTitles.savedToShopify")
                  }
                  version={bankFacing?.version ?? null}
                  timestamp={formattedSubmittedAt}
                  body={
                    bankFacing
                      ? isNetworkSubmitted
                        ? formattedSubmittedAt
                          ? tPkg("savedBody.forwardedWithDate", {
                              version: bankFacing.version,
                              date: formattedSubmittedAt,
                            })
                          : tPkg("savedBody.forwardedNoDate", {
                              version: bankFacing.version,
                            })
                        : isClosed
                          ? formattedSubmittedAt
                            ? tPkg("savedBody.closedWithDate", {
                                version: bankFacing.version,
                                date: formattedSubmittedAt,
                              })
                            : tPkg("savedBody.closedNoDate", {
                                version: bankFacing.version,
                              })
                          : formattedSubmittedAt
                            ? tPkg("savedBody.savedWithDate", {
                                version: bankFacing.version,
                                date: formattedSubmittedAt,
                              })
                            : tPkg("savedBody.savedNoDate", {
                                version: bankFacing.version,
                              })
                      : tPkg("savedBody.fallback")
                  }
                  shopifyAdminUrl={shopifyAdminUrl ?? null}
                  previewHref={previewHref}
                  previewLabel={
                    hasUnsubmittedDraft && latest
                      ? tPkg("reviewDraftPdf", { version: latest.version })
                      : tPkg("viewPdf")
                  }
                  openInShopifyLabel={tPkg("openInShopifyAdmin")}
                />
              )}

              {/* Outcome-expected countdown — only when the card
                  network has the evidence. Sets expectation without
                  promising the network's exact turnaround. */}
              {outcomeExpected ? (
                <Banner tone="info" title={t("cardNetworkReviewingTitle")}>
                  <Text as="p" variant="bodySm">
                    {tPkg("cardNetworkReviewingBody", {
                      days: NETWORK_REVIEW_WINDOW_DAYS,
                      date: outcomeExpected.label,
                    })}
                  </Text>
                </Banner>
              ) : null}

              {/* Section B — New draft available. Suppressed when the
                  card network already has the evidence (regenerating is
                  meaningless: Shopify can't replace the forwarded PDF)
                  or when the dispute has closed.

                  Also suppressed during the optimistic "Saving to
                  Shopify…" window (`submitPending`): the merchant just
                  clicked Resubmit, so prompting them to review-and-
                  resubmit again would look like the click did nothing.
                  The "Saving to Shopify…" banner above carries the
                  status during this gap until the save-to-shopify job
                  flips the latest row to status='submitted'. */}
              {hasUnsubmittedDraft && latest && bankFacing && !isNetworkSubmitted && !isClosed && !submitPending ? (
                <Banner tone="info" title={tPkg("draftBannerTitle", { version: latest.version })}>
                  {/* Banner hosts the workflow's primary action AND the
                      Regenerate overflow, so the merchant doesn't have
                      to scan between the banner copy and a detached
                      action row below the inline preview. Layout: body
                      copy on top, action row underneath. The lower
                      action row inside the card suppresses Approve /
                      Resubmit / More actions while this banner is
                      showing them — see the gates on each button.

                      Body copy combines the two facts that previously
                      lived in separate info banners: (1) the draft
                      exists and needs review/approval, and (2) the
                      bank currently has v{bankFacing.version}, so the
                      draft will REPLACE that version on resubmit. The
                      second fact used to render in a duplicate info
                      banner above the inline preview; folding it here
                      keeps a single status statement. */}
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {latest.status === "draft"
                        ? tPkg("draftBannerBodyDraft", {
                            version: latest.version,
                            bankVersion: bankFacing.version,
                          })
                        : tPkg("draftBannerBodyFinal", {
                            version: latest.version,
                            bankVersion: bankFacing.version,
                          })}
                    </Text>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      {canFinalize && (
                        <Button
                          variant="primary"
                          onClick={onFinalize}
                          disabled={busy !== null}
                          loading={busy === "finalize"}
                        >
                          {tPkg("approveDraft", { version: latest.version })}
                        </Button>
                      )}
                      {canSubmit && !canFinalize ? (
                        <Button
                          variant="primary"
                          tone="success"
                          onClick={onSubmit}
                          disabled={busy !== null}
                          loading={busy === "submit"}
                        >
                          {isSubmittedToBank
                            ? tPkg("resubmitToShopify")
                            : tPkg("submitToShopify")}
                        </Button>
                      ) : null}
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
                              {tPkg("moreActions")}
                            </Button>
                          }
                        >
                          <ActionList
                            items={[
                              {
                                content: rebuildInFlight
                                  ? tPkg("regenerating")
                                  : tPkg("regenerateFromScratch"),
                                helpText: rebuildInFlight
                                  ? tPkg("regenerateHelpInFlight")
                                  : tPkg("regenerateHelp"),
                                onAction: () => {
                                  setMoreActionsOpen(false);
                                  void onRegenerate();
                                },
                                disabled: busy !== null || rebuildInFlight,
                              },
                            ]}
                          />
                        </Popover>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Banner>
              ) : null}
            </BlockStack>
          ) : (
            <InlineStack gap="400" align="space-between">
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">{tPkg("metaStatus")}</Text>
                <StatusBadge status={row.status} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">{tPkg("metaMode")}</Text>
                <Text as="span" variant="bodySm">{row.package_mode ?? "—"}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">{tPkg("metaGenerated")}</Text>
                <Text as="span" variant="bodySm">
                  {new Date(row.generated_at).toLocaleString()}
                </Text>
              </BlockStack>
              {countdown && (
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">{tPkg("metaDeadline")}</Text>
                  <Badge tone={countdown.tone === "info" ? undefined : countdown.tone}>
                    {countdown.label}
                  </Badge>
                </BlockStack>
              )}
            </InlineStack>
          )}

          {row.status === "skipped" && row.failure_code === "covered_shopify" && (
            <Banner tone="info" title={t("coveredByShopifyProtectTitle")}>
              <p>{tPkg("coveredByShopifyProtectBody")}</p>
            </Banner>
          )}

          {row.status === "skipped" && row.failure_code === "no_bank_eligible_facts" && (
            <Banner tone="warning" title={t("notEnoughEvidenceTitle")}>
              <p>{tPkg("notEnoughEvidenceBody")}</p>
            </Banner>
          )}

          {row.status === "failed" && (
            <Banner tone="critical" title={t("validationFailedTitle")}>
              <BlockStack gap="200">
                <p>{row.failure_reason ?? tPkg("validationFailedFallback")}</p>
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
              Regenerate and the build chain is still running 2-3 min
              behind the scenes. The original `busy === "regen"`
              detection only covered the HTTP request itself (returns in
              ms), so the warning banner flashed back the instant the
              POST returned — confusing UX, the merchant just clicked
              Regenerate and was now being told to click it again.
              `pendingRegen` tracks the server-side rebuild window: set
              when the regenerate POST succeeds, cleared when
              `latest.version` exceeds the version we kicked off from.
              Persisted in sessionStorage so a tab reload mid-rebuild
              keeps the in-progress banner. The 15-minute timeout is a
              safety net — if the rebuild genuinely fails and no new
              version ever lands, we fall back to the warning banner
              instead of lying forever. */}
          {row.status === "stale" && rebuildInFlight && (
            <Banner
              tone="info"
              title={t("buildingNewPackageTitle")}
              action={{
                content: refreshing ? t("checking") : t("checkForUpdate"),
                onAction: () => void refresh(),
                loading: refreshing,
              }}
            >
              <p>{t("buildingNewPackageBody")}</p>
            </Banner>
          )}
          {row.status === "stale" && !rebuildInFlight && (
            <Banner tone="warning" title={t("newEvidenceAvailableTitle")}>
              <p>{tPkg("newEvidenceAvailableBody")}</p>
            </Banner>
          )}

          {/* Action row — one primary at a time, plain-language labels,
              Regenerate demoted to a "More actions" overflow.
              Merchant-facing workflow:
                  Review draft  →  Approve  →  Resubmit to Shopify
              The labels intentionally avoid lifecycle jargon
              ("Finalize") because non-technical merchants ask "finalize
              what?" Approve communicates the action clearly.

              While the "Draft vX is ready for review" banner above is
              showing (the `bannerHostsActions` gate), Approve /
              Resubmit / More actions are hosted IN the banner instead
              of this row — so the merchant has a single place to act.
              View PDF stays here because the merchant still wants a
              preview button when there's no draft banner (clean-submit
              flow). */}
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <ButtonGroup>
              {/* PRIMARY: the next step in the workflow, exactly one
                  button at a time.
                    - Draft awaiting approval → "Approve draft vX"
                    - Final awaiting submit  → "Submit to Shopify" /
                                                "Resubmit to Shopify"
                    - Neither (e.g. already submitted, no newer
                      draft) → no primary button. */}
              {canFinalize && latest && !bannerHostsActions && !submitPending && (
                <Button
                  variant="primary"
                  onClick={onFinalize}
                  disabled={busy !== null}
                  loading={busy === "finalize"}
                >
                  {isSubmittedToBank
                    ? tPkg("approveDraft", { version: latest.version })
                    : tPkg("approveVersion", { version: latest.version })}
                </Button>
              )}
              {canSubmit && !canFinalize && !bannerHostsActions && !submitPending && (
                <Button
                  variant="primary"
                  tone="success"
                  onClick={onSubmit}
                  disabled={busy !== null}
                  loading={busy === "submit"}
                >
                  {isSubmittedToBank
                    ? tPkg("resubmitToShopify")
                    : tPkg("submitToShopify")}
                </Button>
              )}

              {/* SECONDARY: review the draft the merchant is about to
                  approve / submit. previewHref tracks displayRow which
                  now follows the latest-first priority — so this
                  always opens the version the merchant is reading
                  inline below.

                  Suppressed when the submitted-package banner is
                  showing (it already renders a View PDF button on the
                  right side of the green banner) to avoid two
                  identical buttons stacked vertically. */}
              {!(isSubmittedToBank && !submitPending) && (
                <Button
                  url={previewHref ?? undefined}
                  target="_blank"
                  external
                  disabled={!previewHref || busy !== null}
                >
                  {hasUnsubmittedDraft && latest
                    ? tPkg("reviewDraftPdf", { version: latest.version })
                    : tPkg("viewPdf")}
                </Button>
              )}
            </ButtonGroup>

            {/* TERTIARY (overflow): Regenerate. Hidden behind "More
                actions" because it's a less-common, destructive
                action (throws away the current draft). Lives in a
                popover so it can't be misclicked as the primary
                action.

                Only renders when canRegenerate is true (matches the
                existing gate — draft / stale / failed status) and the
                draft-review banner above isn't already hosting this
                same popover. */}
            {canRegenerate && !bannerHostsActions && !submitPending && (
              <Popover
                active={moreActionsOpen}
                onClose={() => setMoreActionsOpen(false)}
                activator={
                  <Button
                    onClick={() => setMoreActionsOpen((v) => !v)}
                    disclosure
                    disabled={busy !== null}
                  >
                    {tPkg("moreActions")}
                  </Button>
                }
              >
                <ActionList
                  items={[
                    {
                      content: rebuildInFlight
                        ? tPkg("regenerating")
                        : tPkg("regenerateFromScratch"),
                      helpText: rebuildInFlight
                        ? tPkg("regenerateHelpInFlight")
                        : tPkg("regenerateHelp"),
                      onAction: () => {
                        setMoreActionsOpen(false);
                        void onRegenerate();
                      },
                      // Disable while a rebuild is in flight (server-side job
                      // still running) — double-clicking Regenerate would
                      // queue a redundant job and consume credits.
                      disabled: busy !== null || rebuildInFlight,
                    },
                  ]}
                />
              </Popover>
            )}
          </InlineStack>

          {error && (
            <Banner tone="warning" title={t("couldNotLoadTitle")}>
              <p>{error}</p>
            </Banner>
          )}
        </BlockStack>
      </div>

      {/* Inline HTML defence view — visually mirrors the PDF document
          section-for-section. Hidden when the package has no narrative
          (skipped / failed rows).

          Renders `displayRow` (see priority in the comment block where
          displayRow is computed). When a newer unsubmitted draft
          exists alongside a submitted bank-facing row, a clear banner
          ABOVE the preview names which version the merchant is
          reading so they can't conflate v5's clean prose with v1's
          stale prose. */}
      {/* The "You are reviewing draft vX" info banner previously sat
          here, between the action row and the inline preview. It said
          the same thing as the "Draft vX is ready for review" banner
          inside the card (the bank has v{bankFacing.version}, this
          draft replaces it on resubmit), so two stacked info banners
          read as one repeated thought. The unique fact ("the bank
          currently has v{N}") is now folded into the upper banner's
          body copy. */}
      {displayRow?.narrative_json && displayRow?.facts_json && (
        <DefencePackageHtmlView row={displayRow} dispute={dispute} />
      )}
    </>
  );
}

/* ── Design chrome (Dispute Page Review Submit v2) ─────────────── */

const DEFENCE_CARD_STYLE: CSSProperties = {
  background: "#F6F6F7",
  border: "1px solid #E1E3E5",
  borderRadius: 12,
  padding: 20,
};

const CARD_TITLE_STYLE: CSSProperties = {
  // Bumped from 15 → 20px (Polaris headingLg) so the action card heading
  // sits above the lower preview-card heading in the visual hierarchy.
  fontSize: 20,
  fontWeight: 600,
  color: "#202223",
  margin: "0 0 6px",
  lineHeight: 1.3,
};

const CARD_HELP_STYLE: CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  margin: "0 0 16px",
  lineHeight: 1.55,
  // No maxWidth — let the copy flow to the card edge. Previous 760px cap
  // left dead space on the right at typical embedded-app widths.
};

/**
 * SavedToShopifyPackageBanner — design's `.BannerStack` for the
 * Complete Defence Package card. Solid-green header strip carries the
 * title + (optional) version chip + (optional) timestamp on the
 * right; light-green body holds the explanation paragraph and an
 * action row separated from the prose by a soft green top border.
 *
 * The version chip + timestamp are right-anchored on the header strip
 * via `margin-left: auto`; either can be null without breaking the
 * layout. Action buttons render only when their corresponding URLs
 * are non-null — when both are null the action row is suppressed.
 */
function SavedToShopifyPackageBanner({
  title,
  version,
  timestamp,
  body,
  shopifyAdminUrl,
  previewHref,
  previewLabel,
  openInShopifyLabel,
}: {
  title: string;
  version: number | null;
  timestamp: string | null;
  body: string;
  shopifyAdminUrl: string | null;
  previewHref: string | null;
  previewLabel: string;
  openInShopifyLabel: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }} role="status">
      <div
        style={{
          background: "#008060",
          color: "#fff",
          borderRadius: "8px 8px 0 0",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
            style={{ width: 18, height: 18 }}
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L9 10.94 7.28 9.22a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25Z"
            />
          </svg>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
          {title}
        </span>
        {(version !== null || timestamp) && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 500,
              color: "rgba(255,255,255,0.88)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {version !== null ? (
              <span
                style={{
                  background: "rgba(255,255,255,0.18)",
                  color: "#fff",
                  padding: "1px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                v{version}
              </span>
            ) : null}
            {timestamp ? <span>{timestamp}</span> : null}
          </span>
        )}
      </div>
      <div
        style={{
          background: "#F0FDF4",
          border: "1px solid #86EFAC",
          borderTop: 0,
          borderRadius: "0 0 8px 8px",
          padding: "14px 16px",
          fontSize: 13,
          color: "#14532D",
          lineHeight: 1.55,
        }}
      >
        <p style={{ margin: 0 }}>{body}</p>
        {shopifyAdminUrl || previewHref ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid #BBF7D0",
            }}
          >
            {shopifyAdminUrl ? (
              <Button url={shopifyAdminUrl} target="_blank" external>
                {openInShopifyLabel}
              </Button>
            ) : null}
            <span style={{ flex: 1 }} />
            {previewHref ? (
              <Button url={previewHref} target="_blank" external>
                {previewLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
