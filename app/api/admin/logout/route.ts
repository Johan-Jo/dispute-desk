import { NextResponse } from "next/server";
import { clearAdminSessionOnResponse } from "@/lib/admin/auth";

export const runtime = "nodejs";

/** Use request URL as redirect base so logout works on any host (local, preview, prod) without `NEXT_PUBLIC_APP_URL`. */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/admin/login", request.url));
  clearAdminSessionOnResponse(res);
  return res;
}
