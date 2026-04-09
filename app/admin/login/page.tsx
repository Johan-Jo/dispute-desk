import Link from "next/link";
import { redirect } from "next/navigation";
import { createPortalClient } from "@/lib/supabase/portal";
import { getServiceClient } from "@/lib/supabase/server";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createPortalClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?continue=/admin");
  }

  const db = getServiceClient();
  const { data: grant } = await db
    .from("internal_admin_grants")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (grant) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="bg-white rounded-lg border border-[#E2E8F0] p-8 w-full max-w-md text-center">
        <h1 className="text-xl font-bold text-[#0F172A] mb-2">DisputeDesk Admin</h1>
        <p className="text-sm text-[#667085] mb-4">Internal operator panel</p>
        {sp.reason === "no_access" && (
          <p className="text-sm text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2 mb-4">
            This account does not have internal admin access. Ask an existing admin to add your email
            in <strong className="font-medium">Admin → Team</strong> (you must use the same email as your
            DisputeDesk sign-in).
          </p>
        )}
        <p className="text-sm text-[#667085] mb-6">
          Signed in as{" "}
          <span className="font-medium text-[#0F172A]">{user.email}</span>.
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <Link
            href="/portal/dashboard"
            className="text-[#1D4ED8] hover:underline"
          >
            Go to merchant portal
          </Link>
          <a href="/api/admin/logout" className="text-[#64748B] hover:text-[#0F172A]">
            Sign out
          </a>
        </div>
      </div>
    </div>
  );
}
