"use client";

import { useEffect } from "react";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log so user can see in browser console even if UI is broken
    console.error("[Portal error]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 bg-[#F6F8FB]">
      <div className="max-w-lg w-full bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-8">
        <h1 className="text-xl font-semibold text-[#0B1220] mb-2">
          Something went wrong
        </h1>
        <p className="text-[#667085] text-sm mb-6">
          A client-side error occurred while loading this page. Check the
          browser console for details.
        </p>
        {isDev && (
          <pre className="mb-6 p-4 bg-[#F1F5F9] rounded-lg text-xs text-[#0B1220] overflow-auto max-h-48">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 bg-[#1D4ED8] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8]/90"
          >
            Try again
          </button>
          <a
            href="/portal/dashboard"
            className="px-4 py-2 border border-[#E5E7EB] text-[#0B1220] text-sm font-medium rounded-lg hover:bg-[#F7F8FA]"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
