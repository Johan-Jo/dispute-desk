import type { StreamSignal } from "@/lib/signal-radar/queries";
import { SignalCard, StreamShell } from "./stream-shared";

export function PainPointsStream({ signals }: { signals: StreamSignal[] }) {
  return (
    <StreamShell
      icon="🩹"
      title="Recent merchant pain"
      description="Highest-signal items from the last 14 days across transparency, reserves, operational overload, support failures, and evidence confusion. Sorted by strategic value."
      isEmpty={signals.length === 0}
      emptyMessage="No high-signal pain items yet. The classifier flags items signal ≥ 4 in pain categories — broaden the timeframe or wait for more ingest."
    >
      {signals.map((s) => (
        <SignalCard key={s.source_id} signal={s} />
      ))}
    </StreamShell>
  );
}
