import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Creates a Supabase client for portal auth (uses anon key + cookie session).
 * Only used for portal routes — embedded app uses service role via getServiceClient().
 */
export async function createPortalClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    }
  );
}

/**
 * Returns the current portal user or null.
 */
export async function getPortalUser() {
  const supabase = await createPortalClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns the current portal user or redirects to sign-in.
 */
export async function requirePortalUser() {
  const user = await getPortalUser();
  if (!user) {
    redirect("/auth/sign-in");
  }
  return user;
}
