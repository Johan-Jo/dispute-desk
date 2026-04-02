import type { EmailOtpType } from "@supabase/auth-js";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

/**
 * Maps Supabase Send Email hook `email_action_type` to GoTrue `verifyOtp` `type`.
 */
export function mapActionTypeToOtpType(actionType: string): EmailOtpType | null {
  switch (actionType) {
    case "signup":
      return "signup";
    case "invite":
      return "invite";
    case "recovery":
      return "recovery";
    case "magiclink":
      return "magiclink";
    case "email_change_new":
    case "email_change_current":
      return "email_change";
    default:
      return null;
  }
}

export function isEmailOtpTypeParam(s: string): s is EmailOtpType {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(s);
}

/**
 * Reads `redirect_to` from the hook payload and extracts the post-confirm path
 * and optional `locale` when the URL targets our `/api/auth/confirm` page.
 */
export function parseConfirmParamsFromRedirectTo(redirectTo: string): {
  redirectPath: string;
  localeParam: string | null;
} {
  const defaultPath = "/portal/dashboard";
  if (!redirectTo?.trim()) {
    return { redirectPath: defaultPath, localeParam: null };
  }
  try {
    const u = new URL(redirectTo);
    if (u.pathname.includes("/api/auth/confirm")) {
      const r = u.searchParams.get("redirect");
      const loc = u.searchParams.get("locale");
      return {
        redirectPath: r && r.startsWith("/") ? r : defaultPath,
        localeParam: loc,
      };
    }
    const path = `${u.pathname}${u.search}`;
    return {
      redirectPath: path.startsWith("/") ? path : defaultPath,
      localeParam: null,
    };
  } catch {
    return { redirectPath: defaultPath, localeParam: null };
  }
}
