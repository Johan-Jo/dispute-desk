import type { StreamSignal } from "@/lib/signal-radar/queries";
import { SignalCard, StreamShell } from "./stream-shared";

export function HighValueStream({ signals }: { signals: StreamSignal[] }) {
  return (
    <StreamShell
      icon="💰"
      title="High-value merchant leads"
      description="Merchants who revealed scale signals (GMV, order volume, vertical) AND scored ≥6 on strategic relevance."
      isEmpty={signals.length === 0}
      emptyMessage="No leads with scale signals in the last 14 days."
    >
      {signals.map((s) => (
        <SignalCard key={s.source_id} signal={s} />
      ))}
    </StreamShell>
  );
}
