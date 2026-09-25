/**
 * TEMPORARY — defence-letter advocacy pilot (docs/plans/defence-letter-advocacy.plan.md).
 *
 * Runs ONE model call with the pilot prompt so the letter can be generated
 * where the Anthropic key lives (staging); validation and PDF rendering run
 * locally. Remove after the pilot. Never active in production.
 *
 * Auth: the caller's `x-pilot-token` must hash to PILOT_TOKEN_SHA256 (the
 * token exists only on the maintainer's machine). Public path so the Shopify
 * session middleware does not intercept it; this check is the gate.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

const PILOT_TOKEN_SHA256 = "18ddd8e890e528f31964cf94c4ec47694745f67224789e11f07c0036ed26ad09";
const MODELS = new Set(["claude-sonnet-4-6", "claude-opus-5-5"]);

function authorized(token: string): boolean {
  const got = createHash("sha256").update(token).digest();
  const want = Buffer.from(PILOT_TOKEN_SHA256, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request): Promise<Response> {
  // Staging is the dev project's PRODUCTION deployment (VERCEL_ENV=production),
  // so the allow-list is APP_ENV, the app's own identity.
  if (process.env.APP_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }
  if (!authorized(req.headers.get("x-pilot-token") ?? "")) {
    return new Response("Not found", { status: 404 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) return Response.json({ error: "no key" }, { status: 500 });

  const body = (await req.json()) as { system?: string; user?: string; model?: string; temperature?: number; maxTokens?: number };
  const model = body.model ?? "claude-sonnet-4-6";
  if (!MODELS.has(model)) return Response.json({ error: "model not allowed" }, { status: 400 });
  if (typeof body.system !== "string" || typeof body.user !== "string") {
    return Response.json({ error: "system and user required" }, { status: 400 });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(8000, Math.max(500, body.maxTokens ?? 3000)),
      // Opus 5.5 rejects `temperature` (deprecated for that model).
      ...(model === "claude-opus-5-5"
        ? {}
        : { temperature: typeof body.temperature === "number" ? Math.min(1, Math.max(0, body.temperature)) : 0.4 }),
      system: body.system.slice(0, 40_000),
      messages: [{ role: "user", content: body.user.slice(0, 4_000) }],
    }),
  });
  const json = await res.json();
  return Response.json(json, { status: res.status });
}
