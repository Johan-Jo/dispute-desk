import type { StreamSignal } from "@/lib/signal-radar/queries";
import { SignalCard, StreamShell } from "./stream-shared";

export function SwitchingStream({ signals }: { signals: StreamSignal[] }) {
  return (
    <StreamShell
      icon="🔥"
      title="Merchants actively looking to switch"
      description="Posts where a merchant explicitly named a competitor pain point or asked for an alternative chargeback / dispute tool."
      isEmpty={signals.length === 0}
      emptyMessage="No migration-intent signals in the last 30 days."
    >
      {signals.map((s) => (
        <SignalCard key={s.source_id} signal={s} />
      ))}
    </StreamShell>
  );
}
