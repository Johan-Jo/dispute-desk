"use client";

import { useTranslations } from "next-intl";

const VIDEO_ID = "k7TY52tFr5I";

/**
 * Product demo video for the marketing hero. Renders the standard YouTube embed
 * iframe directly (YouTube serves its own poster frame + play button, so there
 * is no separate thumbnail fetch that can be hotlink-blocked). Framed in the
 * cream "dossier paper" aesthetic below the editorial hero. Copy is i18n-driven.
 */
export function HeroVideo() {
  const t = useTranslations("marketing");

  return (
    <section
      className="dd-brand-hero relative py-12 sm:py-16 lg:py-20 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, var(--dd-hero-bg-start) 0%, var(--dd-hero-bg-mid) 50%, var(--dd-hero-bg-end) 100%)",
      }}
      aria-label={t("videoSection.ariaLabel")}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-10 left-1/4 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.12] dd-hero-blob"
          style={{ backgroundColor: "var(--dd-hero-blob-a)" }}
        />
        <div
          className="absolute -bottom-16 right-1/4 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.1] dd-hero-blob dd-hero-blob-delay-2s"
          style={{ backgroundColor: "var(--dd-hero-blob-c)" }}
        />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-4xl px-4 sm:px-6 text-center">
        <span className="dd-eyebrow justify-center">
          <span className="dd-pill">{t("videoSection.eyebrow")}</span>
        </span>
        <h2 className="mt-4 text-3xl sm:text-4xl font-bold text-white">
          {t("videoSection.title")}
        </h2>
        <p className="mt-3 text-base sm:text-lg text-slate-300 max-w-2xl mx-auto">
          {t("videoSection.subtitle")}
        </p>

        <div className="mt-8 rounded-2xl bg-[var(--dd-paper)] p-2 sm:p-3 shadow-2xl shadow-black/40 ring-1 ring-black/10">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${VIDEO_ID}?rel=0&modestbranding=1`}
              title={t("videoSection.title")}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
}
