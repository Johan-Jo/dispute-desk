"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./embedded-app-chrome.module.css";

const FEEDBACK_DISMISS_KEY = "dd_feedback_dismissed_v2";

/**
 * Embedded app chrome with a feedback banner that appears only after
 * the merchant wins their first chargeback dispute.
 * - 4-5 stars → opens the Shopify app store review page
 * - 1-3 stars → shows an inline feedback form
 */
export function EmbeddedAppChrome({ children }: { children: React.ReactNode }) {
  const t = useTranslations("embeddedShell");
  const [showBanner, setShowBanner] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(FEEDBACK_DISMISS_KEY) === "1") return;
    } catch { /* ignore */ }

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
    setShowForm(false);
  }, []);

  const saveRating = useCallback((star: number, comment?: string | null) => {
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: star, comment: comment ?? null }),
    }).catch(() => {});
  }, []);

  const handleRate = useCallback((star: number) => {
    setFeedbackRating(star);
    if (star >= 4) {
      saveRating(star);
      window.open(
        "https://apps.shopify.com/partners/login?redirect_uri=/apps/disputedesk-1/reviews/new",
        "_blank"
      );
      dismiss();
    } else {
      setShowForm(true);
    }
  }, [dismiss, saveRating]);

  const handleSubmitFeedback = useCallback(async () => {
    setSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: feedbackRating, comment: comment.trim() || null }),
      });
    } catch { /* ignore */ }
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(dismiss, 2000);
  }, [feedbackRating, comment, dismiss]);

  if (!showBanner) {
    return <div className={styles.pageContent}>{children}</div>;
  }

  return (
    <>
      {/* Star rating banner */}
      {!showForm && (
        <div className={styles.feedbackWrap}>
          <div className={styles.feedbackCard}>
            <div className={styles.feedbackLeft}>
              <div className={styles.feedbackThumb}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7 17h5.5a2.5 2.5 0 002.45-2.01l1.3-6.5A1.5 1.5 0 0014.78 7H11V3.5A1.5 1.5 0 009.5 2L7 8v9z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  />
                  <path
                    d="M7 17H4.5A1.5 1.5 0 013 15.5v-6A1.5 1.5 0 014.5 8H7"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className={styles.feedbackText}>
                {t("feedbackPrompt")}{" "}
                <span className={styles.feedbackTextMuted}>{t("feedbackSubtext")}</span>
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
                        star <= (hoveredStar || feedbackRating) ? styles.starFilled : styles.starEmpty
                      }`}
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.44.91-5.32-3.87-3.77 5.34-.78L10 1z"
                        fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
            <button className={styles.dismissBtn} onClick={dismiss} aria-label={t("dismissFeedback")}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Feedback form (1-3 stars) */}
      {showForm && (
        <div className={styles.feedbackFormWrap}>
          <div className={styles.feedbackFormCard}>
            {submitted ? (
              <p className={styles.feedbackFormThanks}>{t("feedbackFormThanks")}</p>
            ) : (
              <>
                <div className={styles.feedbackFormHeader}>
                  <p className={styles.feedbackFormTitle}>{t("feedbackFormTitle")}</p>
                  <button className={styles.dismissBtn} onClick={dismiss} aria-label={t("dismissFeedback")}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <textarea
                  className={styles.feedbackFormTextarea}
                  placeholder={t("feedbackFormPlaceholder")}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                />
                <div className={styles.feedbackFormActions}>
                  <button className={styles.feedbackFormSkip} onClick={dismiss}>
                    {t("feedbackFormSkip")}
                  </button>
                  <button
                    className={styles.feedbackFormSubmit}
                    onClick={handleSubmitFeedback}
                    disabled={submitting}
                  >
                    {submitting ? t("feedbackFormSubmitting") : t("feedbackFormSubmit")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={styles.pageContent}>{children}</div>
    </>
  );
}
