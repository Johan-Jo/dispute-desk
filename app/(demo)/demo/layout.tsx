import { getMessages } from "@/lib/i18n/getMessages";
import { DemoProviders } from "@/components/demo/DemoProviders";
import { AdminShell } from "@/components/demo/AdminShell";
import { GuidedTourProvider, GuidedTourCallout } from "@/components/demo/GuidedTour";
import { FetchShimInstaller } from "@/components/demo/FetchShimInstaller";
import { DemoLinkRewriter } from "@/components/demo/DemoLinkRewriter";

export const metadata = {
  title: "DisputeDesk — Live demo",
  description: "Click through DisputeDesk's Shopify chargeback evidence app. No install required.",
};

export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages("en");
  return (
    <DemoProviders messages={messages}>
      {/* MUST be rendered before AdminShell children so the fetch shim
          installs during the first client script eval, ahead of any
          dashboard/disputes useEffect that fires /api/* calls. */}
      <FetchShimInstaller />
      <DemoLinkRewriter />
      <GuidedTourProvider>
        <AdminShell>{children}</AdminShell>
        <GuidedTourCallout />
      </GuidedTourProvider>
    </DemoProviders>
  );
}
