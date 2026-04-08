"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, ActionList, Popover } from "@shopify/polaris";
import {
  MenuHorizontalIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import styles from "./embedded-app-chrome.module.css";

const FEEDBACK_DISMISS_KEY = "dd_embedded_feedback_banner_dismissed_v1";

export function EmbeddedAppChrome({ children }: { children: React.ReactNode }) {
  const t = useTranslations("embeddedShell");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [feedbackRating, setFeedbackRating] = useState(0);

  useEffect(() => {
    try {
      if (
        typeof window !== "undefined" &&
        localStorage.getItem(FEEDBACK_DISMISS_KEY) === "1"
      ) {
        setFeedbackDismissed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const dismissFeedback = useCallback(() => {
    try {
      localStorage.setItem(FEEDBACK_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setFeedbackDismissed(true);
  }, []);

  const go = useCallback(
    (path: string) => {
      router.push(withShopParams(path, searchParams));
    },
    [router, searchParams],
  );

  const moreActivator = (
    <button
      className={styles.moreBtn}
      onClick={() => setMoreOpen((v) => !v)}
      aria-label={t("moreActions")}
    >
      <Icon source={MenuHorizontalIcon} />
    </button>
  );

  return (
    <>
      {/* Brand row — Figma line 168 */}
      <div className={styles.brandRow}>
        <div className={styles.brandLeft}>
          <div className={styles.shieldTile}>
            <Icon source={ShieldCheckMarkIcon} />
          </div>
          <h1 className={styles.brandTitle}>{t("brandName")}</h1>
        </div>
        <Popover
          active={moreOpen}
          activator={moreActivator}
          autofocusTarget="first-node"
          preferredAlignment="right"
          onClose={() => setMoreOpen(false)}
        >
          <ActionList
            actionRole="menuitem"
            items={[
              {
                content: t("menuHelp"),
                onAction: () => {
                  setMoreOpen(false);
                  go("/app/help");
                },
              },
              {
                content: t("menuSettings"),
                onAction: () => {
                  setMoreOpen(false);
                  go("/app/settings");
                },
              },
            ]}
          />
        </Popover>
      </div>

      {/* Feedback bar — Figma line 184 */}
      {!feedbackDismissed && (
        <div className={styles.feedbackWrap}>
          <div className={styles.feedbackCard}>
            <div className={styles.feedbackLeft}>
              <div className={styles.feedbackThumb}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7 17h5.5a2.5 2.5 0 002.45-2.01l1.3-6.5A1.5 1.5 0 0014.78 7H11V3.5A1.5 1.5 0 009.5 2L7 8v9z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 17H4.5A1.5 1.5 0 013 15.5v-6A1.5 1.5 0 014.5 8H7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className={styles.feedbackText}>
                {t("feedbackPrompt")}{" "}
                <span className={styles.feedbackTextMuted}>
                  {t("feedbackSubtext")}
                </span>
              </span>
              <div className={styles.feedbackStars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    className={styles.starBtn}
                    onClick={() => setFeedbackRating(star)}
                    onMouseEnter={() => setHoveredStar(star)}
                    onMouseLeave={() => setHoveredStar(0)}
                  >
                    <svg
                      viewBox="0 0 20 20"
                      className={`${styles.starIcon} ${
                        star <= (hoveredStar || feedbackRating)
                          ? styles.starFilled
                          : styles.starEmpty
                      }`}
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.44.91-5.32-3.87-3.77 5.34-.78L10 1z"
                        fill="currentColor"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
            <button
              className={styles.dismissBtn}
              onClick={dismissFeedback}
              aria-label={t("dismissFeedback")}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Page content */}
      <div className={styles.pageContent}>{children}</div>
    </>
  );
}
