"use client";

/**
 * Per-dispute-type overrides, layered on the store-wide switch.
 *
 * Deliberately NOT a fourth card on the Automation page. Three cards all
 * answering "what happens to a dispute" is the duplication this codebase spent
 * several PRs deleting. These nest inside the switch card as progressive
 * disclosure, so the page reads as one specificity ladder:
 *
 *   Everything is handled THIS way [switch]
 *     · except these types [groups]
 *     · except above this amount [safeguard]
 *     · and these always get reviewed no matter what [facts]
 *     · plus your own rules [custom]
 *
 * That ladder mirrors the tier system exactly: tier-2 → tier-1 → tier-0 →
 * engine guards → tier-1 custom.
 *
 * LAYOUT IS A TRANSCRIPTION of `Automation Rules Page.dc.html` (Claude Design
 * project "Dispute Desk Design Restoration"). Every colour, radius, size and
 * label below comes from that file — it is the specification, not a starting
 * point. The one thing it does not encode is i18n, so its literal strings are
 * resolved through `t` against the keys it implies.
 *
 * Copy lives under `rules.group*` — one key set, passed in via `t`.
 */

import {
  AUTOMATION_GROUPS,
  type AutomationGroupId,
  type GroupOverrides,
} from "@/lib/rules/automationGroups";
import type { StoreAutomationMode } from "@/lib/rules/storeAutomation";

/**
 * Per-row identity from the design: the icon path and its tint square. Keyed
 * by group id so a new group cannot render without someone choosing how it
 * looks.
 *
 * The design also gave each row a "Playbook: …" sub-label. It is gone: the
 * sub-line's job is to say whether this row is following the store setting or
 * has its own answer, which is the one thing the page was failing to tell
 * anyone. Naming the playbook there was noise competing for the same slot.
 */
const ROW_STYLE: Record<
  AutomationGroupId,
  { icon: string; color: string; tint: string }
> = {
  fraud: {
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    color: "#DC2626",
    tint: "#FEF2F2",
  },
  pnr: {
    icon: "M21 16V8l-9-5-9 5v8l9 5 9-5M3 8l9 5 9-5M12 13v9",
    color: "#3B82F6",
    tint: "#EFF6FF",
  },
  not_as_described: {
    icon: "M12 3l9 16H3l9-16M12 9v5M12 17.4v.01",
    color: "#F59E0B",
    tint: "#FFFBEB",
  },
  subscription: {
    icon: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
    color: "#22C55E",
    tint: "#F0FDF4",
  },
  refund: {
    icon: "M4 4h16v16l-3-2-3 2-3-2-3 2V4M8 9h8M8 13h5",
    color: "#8B5CF6",
    tint: "#F5F3FF",
  },
  duplicate: {
    icon: "M9 9h10v10H9zM5 15V5h10",
    color: "#06B6D4",
    tint: "#ECFEFF",
  },
};

/** Segment accents, from the design's `on(value, bg)` calls. */
const SEGMENT_ACCENT = {
  default: "#64748B",
  auto: "#22C55E",
  review: "#0EA5E9",
} as const;

type Segment = keyof typeof SEGMENT_ACCENT;

interface AutomationGroupListProps {
  /** The store-wide switch — names the inherited mode in the sub-label. */
  storeMode: StoreAutomationMode;
  value: GroupOverrides;
  onChange: (next: GroupOverrides) => void;
  /** Translator bound to the `rules` namespace. */
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Plan-gated or saving — renders non-interactive but still readable. */
  disabled?: boolean;
}

export function AutomationGroupList({
  storeMode,
  value,
  onChange,
  t,
  disabled = false,
}: AutomationGroupListProps) {
  const select = (id: AutomationGroupId, next: Segment) => {
    if (disabled) return;
    const draft = { ...value };
    // `default` is the ABSENCE of an override, not a third stored state.
    if (next === "default") delete draft[id];
    else draft[id] = next;
    onChange(draft);
  };

  return (
    <div>
      {AUTOMATION_GROUPS.map((group) => {
        const style = ROW_STYLE[group.id];
        const current: Segment = value[group.id] ?? "default";
        const effective = current === "default" ? storeMode : current;

        /**
         * THE ONE THING THIS LINE EXISTS TO SAY: is this row following the
         * house rule above, or has it been given its own answer that ignores
         * it?
         *
         * Without it the page contradicted itself in the only way that
         * matters — "Review everything" selected at the top, four rows reading
         * "Automatic", and nothing anywhere explaining that the rows win. A
         * merchant read that as broken, and they were right to.
         *
         * A LOCKED row never follows the house rule and never has its own
         * answer either; it states its own fact via the badge, so it gets no
         * sub-line at all rather than a misleading one.
         */
        const sub = group.locked
          ? null
          : current === "default"
            ? t("groupFollowingStoreSetting", {
                mode: effective === "auto" ? t("autoPack") : t("review"),
              })
            : t("groupHasOwnSetting");

        return (
          <div
            key={group.id}
            data-r="row"
            style={{
              padding: "13px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              borderTop: "1px solid #F1F2F3",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: style.tint,
                color: style.color,
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={style.icon} />
              </svg>
            </span>

            <div
              style={{
                flex: 1,
                minWidth: 190,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#202223" }}>
                {t(group.labelKey)}
              </span>
              {sub && (
                <span
                  style={{
                    fontSize: 12,
                    // A row with its own answer is the exception on the page,
                    // so it reads darker than the ones quietly inheriting.
                    color: current === "default" ? "#6D7175" : "#3B4149",
                    fontWeight: current === "default" ? 400 : 500,
                  }}
                >
                  {sub}
                </span>
              )}
            </div>

            {/* Locked rows state a fact rather than offering a dead control.
                A greyed-out control reads as "you can't afford this" — the
                plan-gate idiom already used on this page. */}
            {group.locked ? (
              <div
                data-r="locked"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  maxWidth: 420,
                }}
              >
                {group.lockedReasonKey && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#6D7175",
                      textAlign: "right",
                      textWrap: "pretty",
                    }}
                  >
                    {t(group.lockedReasonKey)}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "4px 9px",
                    borderRadius: 999,
                    background: "#E0F2FE",
                    color: "#075985",
                    flexShrink: 0,
                  }}
                >
                  {t("groupAlwaysReviewed")}
                </span>
              </div>
            ) : (
              <div
                data-r="seg"
                role="radiogroup"
                aria-label={t(group.labelKey)}
                style={{
                  display: "inline-flex",
                  padding: 3,
                  borderRadius: 9,
                  border: "1px solid #E1E3E5",
                  background: "#F6F8FB",
                  gap: 3,
                  flexShrink: 0,
                  opacity: disabled ? 0.6 : 1,
                }}
              >
                {(
                  [
                    ["default", t("groupStoreDefault"), t("groupStoreDefaultHint")],
                    ["auto", t("autoPack"), undefined],
                    ["review", t("review"), undefined],
                  ] as const
                ).map(([segment, label, title]) => {
                  const active = current === segment;
                  return (
                    <button
                      key={segment}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={title}
                      disabled={disabled}
                      onClick={() => select(group.id, segment)}
                      style={{
                        font: "inherit",
                        border: "none",
                        cursor: disabled ? "default" : "pointer",
                        padding: "5px 11px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        borderRadius: 7,
                        transition: "all 140ms ease",
                        background: active ? SEGMENT_ACCENT[segment] : "transparent",
                        color: active ? "#FFFFFF" : "#6D7175",
                        boxShadow: active
                          ? "0 1px 2px rgba(16,24,40,0.16)"
                          : "none",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Accounts for GENERAL without giving it a row. A second control for
          what the catch-all already does at a different tier is exactly the
          duplication this design avoids. */}
      <div
        style={{
          padding: "11px 20px 13px",
          borderTop: "1px solid #F1F2F3",
          fontSize: 12,
          color: "#6D7175",
        }}
      >
        {t("groupsGeneralNote")}
      </div>
    </div>
  );
}
