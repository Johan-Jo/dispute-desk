import { MessageSquare } from "lucide-react";

export function RecurringPhrasesWidget({
  phrases,
}: {
  phrases: Array<{ phrase: string; count: number }>;
}) {
  const safePhrases = phrases ?? [];
  const max = safePhrases[0]?.count ?? 1;
  return (
    <div className="rounded-lg bg-white border border-[#E2E8F0] p-5">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-[#2563EB]" />
        <h2 className="font-semibold text-[#0F172A]">Top Recurring Phrases (7d)</h2>
      </div>
      {safePhrases.length === 0 ? (
        <p className="text-sm text-[#64748B]">No phrases yet — needs ingested data.</p>
      ) : (
        <ul className="space-y-2">
          {safePhrases.slice(0, 15).map((p) => {
            const pct = Math.max(8, Math.round((p.count / max) * 100));
            return (
              <li key={p.phrase} className="text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[#0F172A] font-medium">{p.phrase}</span>
                  <span className="text-[#64748B] text-xs">{p.count}</span>
                </div>
                <div className="h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
