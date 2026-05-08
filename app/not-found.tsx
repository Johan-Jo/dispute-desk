import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 — Page not found · DisputeDesk",
  description:
    "This page filed a chargeback and won. Let's get you back to a route that actually exists.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F6F8FB] text-[#0B1220]">
      {/* Soft animated gradient blobs (reuse hero tokens) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl dd-hero-blob"
        style={{ background: "radial-gradient(circle, #60a5fa 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full opacity-40 blur-3xl dd-hero-blob dd-hero-blob-delay-2s"
        style={{ background: "radial-gradient(circle, #1d4ed8 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full opacity-30 blur-3xl dd-hero-blob dd-hero-blob-delay-4s"
        style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
        {/* Stamped "CHARGEBACK" badge */}
        <div className="mb-8 inline-flex -rotate-6 items-center gap-2 rounded-md border-2 border-[#EF4444] bg-white/70 px-4 py-1.5 backdrop-blur-sm">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#EF4444]">
            Chargeback
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#EF4444]">
            · Reason: 404
          </span>
        </div>

        {/* Big number */}
        <h1 className="bg-gradient-to-br from-[#1D4ED8] via-[#3b82f6] to-[#60a5fa] bg-clip-text text-[140px] font-black leading-none tracking-tight text-transparent sm:text-[200px]">
          404
        </h1>

        <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
          This page filed a chargeback and won.
        </h2>

        <p className="mt-4 max-w-xl text-base text-[#64748B] sm:text-lg">
          We searched the URL, the order history, and even checked under the
          shipping label. No evidence of this page ever existing.
        </p>

        {/* Fake "evidence pack" card */}
        <div className="mt-10 w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white/80 p-5 text-left shadow-sm backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Evidence Pack
            </span>
            <span className="rounded-full bg-[#FEF2F2] px-2.5 py-0.5 text-xs font-semibold text-[#EF4444]">
              Insufficient
            </span>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-[#64748B]">Page exists</span>
              <span className="font-mono text-[#EF4444]">✗ missing</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#64748B]">URL fulfilled</span>
              <span className="font-mono text-[#EF4444]">✗ unfulfilled</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#64748B]">Customer happy</span>
              <span className="font-mono text-[#F59E0B]">~ unclear</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#64748B]">Recommended action</span>
              <span className="font-semibold text-[#1D4ED8]">Go home</span>
            </li>
          </ul>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#1D4ED8] px-6 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-2"
          >
            Take me home
          </Link>
          <Link
            href="/resources"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white px-6 text-sm font-medium text-[#0B1220] transition-colors hover:bg-[#F1F5F9]"
          >
            Browse resources
          </Link>
        </div>

        <p className="mt-10 text-xs text-[#94A3B8]">
          Error code: <span className="font-mono">404_PAGE_NOT_FOUND</span> ·
          No representment available.
        </p>
      </div>
    </main>
  );
}
