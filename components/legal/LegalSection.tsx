import type { ReactNode } from "react";

export interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/**
 * One section of a legal/support page. Heading + anchor + prose body.
 *
 * Body uses the @tailwindcss/typography `prose` classes so paragraphs,
 * lists, links, and `code` elements inside `children` render with
 * consistent typography across all five pages without the page authors
 * needing to re-style each tag.
 */
export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2
        id={`${id}-title`}
        className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50"
      >
        {title}
      </h2>
      <div className="prose prose-slate mt-4 max-w-none text-slate-700 dark:prose-invert dark:text-slate-300 prose-headings:tracking-tight prose-a:text-[#1D4ED8] prose-a:no-underline hover:prose-a:underline dark:prose-a:text-blue-400 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal dark:prose-code:bg-slate-800">
        {children}
      </div>
    </section>
  );
}
