import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/admin/auth";

export const runtime = "nodejs";

export async function GET() {
  await clearAdminSession();
  return NextResponse.redirect(new URL("/admin/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
