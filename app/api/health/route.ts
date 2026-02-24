import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.0.1",
    apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-01",
  });
}
