"use client";

import { DemoTopBar } from "./DemoTopBar";
import { InertSidebar } from "./InertSidebar";
import { InstallCTA } from "./InstallCTA";
import { DemoToastProvider } from "./DemoToast";

interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return (
    <DemoToastProvider>
      <div className="min-h-screen flex flex-col bg-[#F1F2F4]">
        <DemoTopBar />
        <div className="flex flex-1 min-h-0">
          <InertSidebar />
          <main className="flex-1 min-w-0 overflow-y-auto">
            {/* Content width matches Polaris-Page's natural max
                (998px / 62.375rem). Going wider than this breaks the
                inner Card / Layout.Section grid logic in the real
                embedded components — they assume a constrained Page
                container and float into inset/two-column states that
                don't align with each other at wider widths. Keep this
                in sync with --pg-layout-width-primary-max + secondary
                so every section reads at a consistent edge. */}
            <div className="mx-auto max-w-[1040px] px-6 py-6">
              {children}
            </div>
          </main>
        </div>
        <InstallCTA variant="floating" />
      </div>
    </DemoToastProvider>
  );
}
