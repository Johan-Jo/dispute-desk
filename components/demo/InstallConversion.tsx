"use client";

import { CheckCircle2, Sparkles, Eye, Shield, TrendingUp } from "lucide-react";
import Link from "next/link";
import { InstallCTA } from "./InstallCTA";

const VALUE_BULLETS = [
  { Icon: Sparkles, title: "Auto-build dispute evidence packs", body: "From order, payment, fulfillment, and customer history — in seconds, with zero merchant input." },
  { Icon: Eye, title: "Review before submission", body: "Or let DisputeDesk submit automatically when the case is Strong. You're always in control." },
  { Icon: Shield, title: "Built-in safety gates", body: "Coverage gate respects Shopify Protect. Fatal-loss gate stops you from confessing to the bank by accident." },
  { Icon: TrendingUp, title: "Keep recovered revenue", body: "No success fees. Flat monthly plans starting at $29." },
];

export function InstallConversion() {
  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7C3AED] mb-5">
          <CheckCircle2 className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-3xl font-semibold text-[#0B1220]">Ready to automate your Shopify chargeback workflow?</h1>
        <p className="text-base text-[#6B7280] mt-3 leading-relaxed">
          You&apos;ve seen what DisputeDesk does. Install in two clicks from the Shopify App Store and start auto-building evidence packs today.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {VALUE_BULLETS.map((b) => (
          <div key={b.title} className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <b.Icon className="w-5 h-5 text-[#7C3AED] mb-2" />
            <div className="text-sm font-semibold text-[#0B1220]">{b.title}</div>
            <div className="text-xs text-[#6B7280] mt-1 leading-relaxed">{b.body}</div>
          </div>
        ))}
      </div>

      <div className="text-center">
        <InstallCTA variant="primary" />
        <div className="mt-3 text-xs text-[#6B7280]">
          14-day free trial · No credit card required · Cancel anytime
        </div>
        <div className="mt-6">
          <Link href="/demo" className="text-xs text-[#6B7280] hover:text-[#0B1220] hover:underline transition-colors">
            ← Back to the demo
          </Link>
        </div>
      </div>

      <div className="mt-12 pt-8 border-t border-[#E5E7EB] text-center">
        <div className="text-xs uppercase tracking-wider text-[#9CA3AF] mb-3">Trusted by Shopify merchants</div>
        <div className="flex items-center justify-center gap-8 opacity-50">
          <div className="text-sm font-semibold text-[#6B7280]">100+ stores</div>
          <div className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
          <div className="text-sm font-semibold text-[#6B7280]">$1M+ recovered</div>
          <div className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
          <div className="text-sm font-semibold text-[#6B7280]">87% win rate</div>
        </div>
      </div>
    </div>
  );
}
