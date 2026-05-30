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
            {/* The DisputeDesk embedded surface. Bumped from 1200px to
                1480px so the 5-tile KPI row on the dashboard
                (Active / Win / Recovered / At Risk / Chargeback rate)
                stays on a single line at typical laptop widths instead
                of wrapping the chargeback tile to a second row. */}
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
