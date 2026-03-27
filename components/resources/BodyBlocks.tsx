import type { ReactNode } from "react";

type BodyJson = {
  mainHtml?: string;
  keyTakeaways?: string[];
  faq?: { q: string; a: string }[];
  disclaimer?: string;
  updateLog?: { at: string; note: string }[];
};

export function BodyBlocks({ body }: { body: Record<string, unknown> }) {
  const b = body as BodyJson;
  const nodes: ReactNode[] = [];

  if (b.keyTakeaways?.length) {
    nodes.push(
      <section key="takeaways" className="mb-10">
        <h2 className="text-lg font-semibold text-[#0B1220] mb-3">Key takeaways</h2>
        <ul className="list-disc pl-5 space-y-2 text-[#334155]">
          {b.keyTakeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>
    );
  }

  if (b.mainHtml) {
    nodes.push(
      <div
        key="main"
        className="prose prose-slate max-w-none mb-10"
        dangerouslySetInnerHTML={{ __html: b.mainHtml }}
      />
    );
  }

  if (b.faq?.length) {
    nodes.push(
      <section key="faq" className="mb-10">
        <h2 className="text-lg font-semibold text-[#0B1220] mb-4">FAQ</h2>
        <dl className="space-y-4">
          {b.faq.map((f, i) => (
            <div key={i}>
              <dt className="font-medium text-[#0B1220]">{f.q}</dt>
              <dd className="mt-1 text-[#64748B]">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  if (b.disclaimer) {
    nodes.push(
      <p key="disc" className="text-sm text-[#94A3B8] border-t border-[#E5E7EB] pt-6">
        {b.disclaimer}
      </p>
    );
  }

  if (b.updateLog?.length) {
    nodes.push(
      <section key="log" className="mt-8">
        <h3 className="text-sm font-semibold text-[#0B1220] mb-2">Updates</h3>
        <ul className="text-sm text-[#64748B] space-y-1">
          {b.updateLog.map((u, i) => (
            <li key={i}>
              <time>{u.at}</time> — {u.note}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return <>{nodes}</>;
}
