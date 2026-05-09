import { ExternalLink } from "lucide-react";
import type { StreamSignal } from "@/lib/signal-radar/queries";
import { categoryLabel } from "@/lib/signal-radar/category-labels";

export function SignalCard({ signal }: { signal: StreamSignal }) {
  const headline = signal.title ?? signal.excerpt.slice(0, 100);
  return (
    <article className="rounded-md border border-[#E2E8F0] bg-white p-4 hover:border-[#CBD5E1] transition-colors">
      <div className="flex items-center gap-2 flex-wrap mb-2 text-xs text-[#64748B]">
        <SourceBadge platform={signal.platform} subreddit={signal.subreddit} />
        <span>·</span>
        <span>{categoryLabel(signal.category)}</span>
        <span>·</span>
        <span>{relativeTime(signal.posted_at)}</span>
        {signal.competitor && (
          <>
            <span>·</span>
            <span className="px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] font-medium">
              {signal.competitor}
            </span>
          </>
        )}
      </div>
      <p className="text-sm text-[#0F172A] font-medium mb-1.5 line-clamp-2">
        “{headline}”
      </p>
      <p className="text-xs text-[#475569] line-clamp-2 mb-2">{signal.summary}</p>
      {signal.merchant_scale_signals.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {signal.merchant_scale_signals.slice(0, 4).map((s, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#0F172A]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#94A3B8]">
          signal {signal.signal_score} · emotion {signal.emotional_intensity_score} · confidence{" "}
          {signal.source_confidence_score}
        </span>
        <a
          href={signal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#2563EB] hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </a>
      </div>
    </article>
  );
}

export function StreamShell({
  icon,
  title,
  description,
  children,
  emptyMessage,
  isEmpty,
}: {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
}) {
  return (
    <section className="rounded-lg bg-white border border-[#E2E8F0] p-5">
      <header className="mb-4">
        <h2 className="font-semibold text-[#0F172A] text-lg flex items-center gap-2">
          <span aria-hidden>{icon}</span>
          {title}
        </h2>
        <p className="text-xs text-[#64748B] mt-1">{description}</p>
      </header>
      {isEmpty ? (
        <div className="rounded border border-dashed border-[#E2E8F0] p-8 text-center text-sm text-[#94A3B8]">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function SourceBadge({
  platform,
  subreddit,
}: {
  platform: string;
  subreddit: string | null;
}) {
  if (platform === "shopify_community") {
    return <span className="font-medium text-[#0F172A]">community.shopify.com</span>;
  }
  if (platform === "reddit") {
    return (
      <span className="font-medium text-[#0F172A]">
        {subreddit ?? "reddit"}
      </span>
    );
  }
  return <span className="font-medium text-[#0F172A]">{platform}</span>;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
