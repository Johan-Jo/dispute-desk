"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

const CAL_URL = "https://cal.com/disputedesk";

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

type Status = "idle" | "invalid" | "sending" | "done";

/**
 * Inline lead-capture form. Two instances on the page (hero + final), each
 * tagged with a `source` for attribution. On success it swaps to the
 * "check your inbox" state with a deep link straight into the Playbook reader.
 */
function CaptureForm({
  source,
  base,
  locale,
  variant,
}: {
  source: "hero" | "final";
  base: string;
  locale: string;
  variant: "hero" | "final";
}) {
  const t = useTranslations("playbook");
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [readUrl, setReadUrl] = useState(`${base}/playbook/read`);
  const honeyRef = useRef<HTMLInputElement>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const value = email.trim();
      if (!isEmail(value)) {
        setStatus("invalid");
        return;
      }
      setStatus("sending");

      // Collect UTM params from the URL for attribution.
      const utm: Record<string, string> = {};
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        for (const key of [
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_term",
          "utm_content",
        ]) {
          const v = params.get(key);
          if (v) utm[key] = v;
        }
      }

      try {
        const res = await fetch("/api/playbook/lead", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: value,
            source,
            locale,
            utm,
            _honey: honeyRef.current?.value ?? "",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          readUrl?: string;
          error?: string;
        };
        if (res.ok && data.ok) {
          if (data.readUrl) setReadUrl(data.readUrl);
          setStatus("done");
        } else {
          // Surface a generic error inline (reuse the invalid slot styling).
          setStatus("invalid");
        }
      } catch {
        setStatus("invalid");
      }
    },
    [email, source, locale],
  );

  const wrapClass = variant === "hero" ? "pb-capture" : "pb-final-capture";

  if (status === "done") {
    return (
      <div className={wrapClass}>
        <div className="pb-success">
          <h4>{t("successTitle")}</h4>
          <p>{t("successBody")}</p>
          <a className="pb-read" href={readUrl}>
            {t("readCta")} →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <form noValidate onSubmit={onSubmit}>
        {/* Honeypot — visually hidden, bots fill it. */}
        <input
          ref={honeyRef}
          type="text"
          name="_honey"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            width: 1,
            height: 1,
            opacity: 0,
          }}
        />
        <input
          type="email"
          name="email"
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          aria-label="Work email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "invalid") setStatus("idle");
          }}
          disabled={status === "sending"}
        />
        <button type="submit" className="pb-btn" disabled={status === "sending"}>
          {t("submit")} →
        </button>
      </form>
      {status === "invalid" && <div className="pb-err">{t("errInvalid")}</div>}
      <div className="pb-micro">
        {variant === "hero" && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2L4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        )}
        {t("micro")}
      </div>
    </div>
  );
}

export function PlaybookLandingClient({
  base,
  locale,
}: {
  base: string;
  locale: string;
}) {
  const t = useTranslations("playbook");

  return (
    <div className="dd-playbook">
      <MarketingSiteHeader />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <header className="pb-hero">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <div className="pb-hero-grid">
            <div>
              <div className="pb-eyebrow">
                <span>§</span> {t("eyebrow")}
              </div>
              <h1 className="pb-h1">
                {t("headlineA")}
                <em>{t("headlineEm")}</em>
                {t("headlineB")}
              </h1>
              <p
                className="pb-lede"
                dangerouslySetInnerHTML={{ __html: t.raw("lede") as string }}
              />
              <CaptureForm source="hero" base={base} locale={locale} variant="hero" />
            </div>

            <div className="pb-cover-art">
              <div className="pb-cover">
                <div className="pb-dots" />
                <div className="pb-stamp">
                  <span>{t("coverStamp")}</span>
                </div>
                <div className="pb-cv-eyebrow">{t("coverEyebrow")}</div>
                <div className="pb-cv-title">
                  The Liability-
                  <br />
                  <em>Shift</em> Playbook
                </div>
                <div className="pb-cv-sub">{t("coverSub")}</div>
                <div className="pb-cv-foot">
                  <span>EN · 2026</span>
                  <span>DP-LM-01</span>
                </div>
              </div>
              <div className="pb-ribbon">{t("coverRibbon")}</div>
            </div>
          </div>
        </div>
      </header>

      {/* ── What's inside ──────────────────────────────────────────────── */}
      <section className="dd-paper-tex" style={{ background: "#fbf7ee" }}>
        <div className={MARKETING_PAGE_CONTAINER_CLASS} style={{ paddingTop: 70, paddingBottom: 70 }}>
          <div className="pb-sec-eyebrow">
            <span>§</span> {t("insideEyebrow")}
          </div>
          <h2 className="pb-sec-h">{t("insideH")}</h2>
          <p className="pb-sec-lede">{t("insideLede")}</p>
          <div className="pb-inside-grid">
            <div className="pb-icard">
              <div className="pb-n">01</div>
              <h4>{t("card1H")}</h4>
              <p>{t("card1P")}</p>
            </div>
            <div className="pb-icard">
              <div className="pb-n">02</div>
              <h4>{t("card2H")}</h4>
              <p>{t("card2P")}</p>
            </div>
            <div className="pb-icard">
              <div className="pb-n">03</div>
              <h4>{t("card3H")}</h4>
              <p>{t("card3P")}</p>
            </div>
            <div className="pb-icard">
              <div className="pb-n">04</div>
              <h4>{t("card4H")}</h4>
              <p>{t("card4P")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Honest edge ────────────────────────────────────────────────── */}
      <section className="pb-edge">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <div className="pb-edge-grid">
            <div>
              <blockquote>
                <span className="pb-mk">&ldquo;</span>
                <span dangerouslySetInnerHTML={{ __html: t.raw("edgeQuote") as string }} />
                <span className="pb-mk">&rdquo;</span>
              </blockquote>
              <div className="pb-who">{t("edgeWho")}</div>
            </div>
            <div className="pb-points">
              <div className="pb-pt">
                <span className="pb-tick">✓</span>
                <p dangerouslySetInnerHTML={{ __html: t.raw("edgePt1") as string }} />
              </div>
              <div className="pb-pt">
                <span className="pb-tick">✓</span>
                <p dangerouslySetInnerHTML={{ __html: t.raw("edgePt2") as string }} />
              </div>
              <div className="pb-pt">
                <span className="pb-tick">✓</span>
                <p dangerouslySetInnerHTML={{ __html: t.raw("edgePt3") as string }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="pb-final dd-paper-tex">
        <div className={MARKETING_PAGE_CONTAINER_CLASS} style={{ paddingTop: 72, paddingBottom: 80 }}>
          <div className="pb-sec-eyebrow" style={{ justifyContent: "center" }}>
            <span>§</span> {t("finalEyebrow")}
          </div>
          <h2>
            {t("finalH")}
            <em>{t("finalHEm")}</em>.
          </h2>
          <CaptureForm source="final" base={base} locale={locale} variant="final" />
          <div className="pb-alt">
            {t("finalAlt")} <a href={CAL_URL}>{t("finalAltLink")}</a>
          </div>
        </div>
      </section>

      <MarketingSiteFooter base={base} />
    </div>
  );
}
