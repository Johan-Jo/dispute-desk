import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

type AssistAction = "improve_readability" | "generate_meta" | "suggest_related";

const ACTION_PROMPTS: Record<AssistAction, string> = {
  improve_readability: `You are an expert editor. Improve the readability of the following content. Simplify complex sentences, improve flow, and make it more engaging. Return the improved HTML content only, no explanations.`,
  generate_meta: `Generate an SEO-optimized meta description (max 160 characters) for the following content. Return ONLY the meta description text, nothing else.`,
  suggest_related: `Based on the following article content about chargebacks/payment disputes, suggest 3-5 related topic titles that would complement this article. Return a JSON array of strings: ["Topic 1", "Topic 2", ...]`,
};

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
  }

  const body = await req.json();
  const action = body.action as AssistAction;
  const content = body.content as string;

  if (!action || !ACTION_PROMPTS[action]) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const model = process.env.GENERATION_MODEL ?? "gpt-4o";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: ACTION_PROMPTS[action] },
          { role: "user", content: content.slice(0, 8000) },
        ],
        temperature: 0.5,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${errBody.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const result = data.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({ result, tokensUsed: data.usage?.total_tokens ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
