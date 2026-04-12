"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./embedded-app-chrome.module.css";

const FEEDBACK_DISMISS_KEY = "dd_feedback_dismissed_v2";

/**
 * Embedded app chrome with a feedback banner that appears only after
 * the merchant wins their first chargeback dispute. On positive ratings
 * (4-5 stars), opens the Shopify app store review page.
 */
export function EmbeddedAppChrome({ children }: { children: React.ReactNode }) {
  const t = useTranslations("embeddedShell");
  const [showBanner, setShowBanner] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [feedbackRating, setFeedbackRating] = useState(0);

  useEffect(() => {
    // Skip if already dismissed
    try {
      if (localStorage.getItem(FEEDBACK_DISMISS_KEY) === "1") return;
    } catch { /* ignore */ }

    // Check if merchant is eligible (has first win)
    fetch("/api/feedback/eligibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.eligible) setShowBanner(true);
      })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(FEEDBACK_DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShowBanner(false);
  }, []);

  const handleRate = useCallback((star: number) => {
    setFeedbackRating(star);
    // Positive rating → open Shopify app store review page
    if (star >= 4) {
      // Use shopify global to get the app handle for the review URL
      const apiKey = document.querySelector<HTMLScriptElement>(
        "script[data-api-key]"
      )?.dataset.apiKey;
      if (apiKey) {
        window.open(
          `https://apps.shopify.com/partners/login?redirect_uri=/apps/disputedesk-1/reviews/new`,
          "_blank"
        );
      }
      dismiss();
    } else if (star >= 1) {
      // Low rating → dismiss and optionally could open a feedback form later
      dismiss();
    }
  }, [dismiss]);

  return (
    <>
      {showBanner && (
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
                    onClick={() => handleRate(star)}
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
              onClick={dismiss}
              aria-label={t("dismissFeedback")}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div className={styles.pageContent}>{children}</div>
    </>
  );
}
