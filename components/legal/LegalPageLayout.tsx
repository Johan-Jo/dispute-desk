import Link from "next/link";
import { Shield } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared shell for the legal/support pages under app/(marketing)/.
 *
 * - Centered prose container, mobile-first, dark-mode aware.
 * - Slim header with brand mark + back-to-home link (no heavy marketing chrome).
 * - Slim footer with cross-links between Privacy / Terms / Security /
 *   Data Retention / Support and a single copyright line.
 * - Renders an in-page TOC built from the section ids the page passes in,
 *   so long policies stay navigable on mobile and desktop.
 */

export interface LegalPageSection {
  id: string;
  title: string;
}

export interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  intro: ReactNode;
  sections: LegalPageSection[];
  children: ReactNode;
}

const LEGAL_NAV: Array<{ href: string; label: string }> = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
  { href: "/data-retention", label: "Data Retention" },
  { href: "/support", label: "Support" },
];

export function LegalPageLayout({
  title,
  lastUpdated,
  intro,
  sections,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Slim header */}
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-900 transition-colors hover:text-slate-700 dark:text-slate-100 dark:hover:text-slate-300"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1D4ED8]">
              <Shield className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
            DisputeDesk
          </Link>
          <nav aria-label="Legal" className="hidden gap-6 text-sm text-slate-600 sm:flex dark:text-slate-400">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-slate-900 dark:hover:text-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Page body */}
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <div className="mb-10 sm:mb-12">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
            {title}
          </h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Last updated: {lastUpdated}
          </p>
          <div className="mt-6 text-base leading-7 text-slate-700 dark:text-slate-300">
            {intro}
          </div>
        </div>

        {sections.length > 0 && (
          <nav
            aria-label="On this page"
            className="mb-12 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
              On this page
            </p>
            <ol className="space-y-2 text-slate-600 dark:text-slate-400">
              {sections.map((s, idx) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="transition-colors hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span className="mr-2 tabular-nums text-slate-400 dark:text-slate-500">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="space-y-12">{children}</div>
      </main>

      {/* Slim footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
          <p>© {new Date().getUTCFullYear()} DisputeDesk. Not affiliated with Shopify Inc.</p>
          <nav aria-label="Footer legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-slate-900 dark:hover:text-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
