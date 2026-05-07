import Link from "next/link";

export interface CTAFooterProps {
  /** Headline above the CTA block. */
  title: string;
  /** Supporting paragraph below the headline. */
  description: string;
  /** Primary button label + href. */
  primary: { label: string; href: string };
  /** Optional secondary link rendered next to the primary button. */
  secondary?: { label: string; href: string };
}

/**
 * End-of-page call-to-action block. Used to route readers from a legal
 * or support page back to the most useful next destination (contact us
 * for legal/support questions, install for marketing reads).
 */
export function CTAFooter({ title, description, primary, secondary }: CTAFooterProps) {
  const isMailto = primary.href.startsWith("mailto:");

  return (
    <aside
      aria-label="Next steps"
      className="mt-16 rounded-xl border border-slate-200 bg-slate-50 p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="text-lg font-semibold text-slate-900 sm:text-xl dark:text-slate-50">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        {isMailto ? (
          <a
            href={primary.href}
            className="inline-flex items-center justify-center rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#1E40AF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {primary.label}
          </a>
        ) : (
          <Link
            href={primary.href}
            className="inline-flex items-center justify-center rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#1E40AF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {primary.label}
          </Link>
        )}
        {secondary &&
          (secondary.href.startsWith("mailto:") ? (
            <a
              href={secondary.href}
              className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              {secondary.label} →
            </a>
          ) : (
            <Link
              href={secondary.href}
              className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              {secondary.label} →
            </Link>
          ))}
      </div>
    </aside>
  );
}
