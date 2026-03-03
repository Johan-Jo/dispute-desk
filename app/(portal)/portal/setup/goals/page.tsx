import { redirect } from "next/navigation";

/**
 * Legacy URL: redirect to the full wizard step so old links and tests still work.
 */
export default function SetupGoalsRedirect() {
  redirect("/portal/setup/welcome_goals");
}
