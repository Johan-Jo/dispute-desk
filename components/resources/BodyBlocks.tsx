import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle } from "lucide-react";

type BodyJson = {
  mainHtml?: string;
  keyTakeaways?: string[];
  faq?: { q: string; a: string }[];
  disclaimer?: string;
  updateLog?: { at: string; note: string }[];
};

export function BodyBlocks({
  body,
  takeawaysLabel = "Key Takeaways",
  disclaimerLabel = "Disclaimer",
  disclaimerText,
  updatesLabel = "Updates",
}: {
  body: Record<string, unknown>;
  takeawaysLabel?: string;
  disclaimerLabel?: string;
  /** When provided, overrides `body.disclaimer` — useful for translated fallback. */
  disclaimerText?: string;
  updatesLabel?: string;
}) {
  const b = body as BodyJson;
  const nodes: ReactNode[] = [];

  if (b.mainHtml) {
    nodes.push(
      <div
        key="main"
        className="prose prose-slate max-w-none mb-10 prose-headings:text-[#0B1220] prose-p:text-[#0B1220] prose-p:leading-relaxed prose-li:text-[#0B1220] prose-a:text-[#1D4ED8] prose-strong:text-[#0B1220] prose-img:max-w-full prose-img:rounded-xl prose-table:border-collapse prose-th:bg-[#F6F8FB] prose-th:text-left prose-th:px-4 prose-th:py-2 prose-td:px-4 prose-td:py-2 prose-td:border-t prose-td:border-[#E5E7EB]"
        dangerouslySetInnerHTML={{ __html: b.mainHtml }}
      />
    );
  }

  if (b.keyTakeaways?.length) {
    nodes.push(
      <section
        key="takeaways"
        className="bg-gradient-to-br from-[#1D4ED8] to-[#1e40af] rounded-2xl p-8 text-white mb-10"
      >
        <h3 className="text-2xl font-bold mb-6">{takeawaysLabel}</h3>
        <div className="space-y-3">
          {b.keyTakeaways.map((t, i) => (
            <div key={i} className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (b.faq?.length) {
    nodes.push(
      <section key="faq" className="mb-10">
        <h2 className="text-2xl font-bold text-[#0B1220] mb-6">FAQ</h2>
        <div className="space-y-4">
          {b.faq.map((f, i) => (
            <div
              key={i}
              className="bg-white border border-[#E5E7EB] rounded-lg p-6"
            >
              <dt className="font-bold text-[#0B1220] mb-2">{f.q}</dt>
              <dd className="text-[#64748B] leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (b.disclaimer || disclaimerText) {
    nodes.push(
      <div
        key="disc"
        className="bg-[#FEF2F2] border-l-4 border-[#EF4444] p-6 rounded-r-lg mb-10"
      >
        <div className="flex gap-3">
          <AlertTriangle className="w-6 h-6 text-[#EF4444] flex-shrink-0" />
          <div>
            <h3 className="text-lg font-bold text-[#0B1220] mb-2">
              {disclaimerLabel}
            </h3>
            <p className="text-[#64748B] leading-relaxed">{disclaimerText ?? b.disclaimer}</p>
          </div>
        </div>
      </div>
    );
  }

  if (b.updateLog?.length) {
    nodes.push(
      <section key="log" className="mt-8 bg-white border border-[#E5E7EB] rounded-lg p-6">
        <h3 className="text-sm font-semibold text-[#0B1220] mb-3">{updatesLabel}</h3>
        <ul className="text-sm text-[#64748B] space-y-2">
          {b.updateLog.map((u, i) => (
            <li key={i} className="flex gap-2">
              <time className="font-medium text-[#0B1220] shrink-0">
                {u.at}
              </time>
              <span>— {u.note}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return <>{nodes}</>;
}
