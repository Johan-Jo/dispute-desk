"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const VIDEO_ID = "k7TY52tFr5I";

/**
 * Lazy YouTube facade for the marketing hero. Renders the video thumbnail with a
 * play button on first paint (no YouTube scripts loaded), then swaps in the
 * privacy-enhanced nocookie iframe on click. Framed in the cream "dossier paper"
 * aesthetic so it sits naturally below the editorial hero. Copy is i18n-driven.
 */
export function HeroVideo() {
  const t = useTranslations("marketing");
  const [playing, setPlaying] = useState(false);

  // maxresdefault falls back to hqdefault automatically for older uploads.
  const thumb = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`;

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
            {playing ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
                title={t("videoSection.title")}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="group absolute inset-0 h-full w-full cursor-pointer"
                aria-label={t("videoSection.playLabel")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb}
                  alt={t("videoSection.thumbnailAlt")}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/10" />
                <span className="absolute left-1/2 top-1/2 flex h-16 w-16 sm:h-20 sm:w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 shadow-xl transition-transform group-hover:scale-110">
                  <svg
                    viewBox="0 0 24 24"
                    className="ml-1 h-7 w-7 sm:h-9 sm:w-9 fill-white"
                    aria-hidden
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
