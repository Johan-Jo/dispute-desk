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
            {/* Demo gets the full viewport width capped at 1480px so
                tile rows feel airy. Polaris-Page's internal 998px cap
                is lifted in DemoProviders so inner Layout.Section
                rows fill the full width consistently. */}
            <div className="mx-auto max-w-[1480px] px-6 py-6">
              {children}
            </div>
          </main>
        </div>
        <InstallCTA variant="floating" />
      </div>
    </DemoToastProvider>
  );
}
