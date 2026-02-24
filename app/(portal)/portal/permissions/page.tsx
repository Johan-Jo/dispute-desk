import { AuthCard } from "@/components/ui/auth-card";
import { InlineError } from "@/components/ui/inline-error";
import { Button } from "@/components/ui/button";

export default function PermissionsPage() {
  return (
    <div className="max-w-md mx-auto py-8">
      <h2 className="text-2xl font-bold text-[#0B1220] mb-2">
        Permission required
      </h2>
      <p className="text-sm text-[#667085] mb-6">
        We need additional permissions to connect your store
      </p>

      <InlineError
        title="Missing permissions"
        message="The app needs access to read orders and disputes. Please ask your store owner or admin to approve these permissions."
      />

      <div className="bg-[#F7F8FA] rounded-lg p-4 mt-4">
        <h4 className="font-semibold text-[#0B1220] mb-2">
          Required permissions:
        </h4>
        <ul className="space-y-1 text-sm text-[#667085]">
          <li>&bull; Read orders</li>
          <li>&bull; Read disputes</li>
          <li>&bull; Read customer data</li>
          <li>&bull; Read fulfillments</li>
        </ul>
      </div>

      <div className="space-y-3 mt-6">
        <a href="/portal/connect-shopify">
          <Button variant="primary" className="w-full">
            Retry connection
          </Button>
        </a>
        <Button variant="ghost" className="w-full">
          Contact support
        </Button>
      </div>
    </div>
  );
}
