/**
 * Server-side loaders for the Defence Package admin section.
 *
 * Mirrors the pattern in `lib/signal-radar/queries.ts` and
 * `lib/resources/admin-queries.ts`.
 */

import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { ALL_REASON_CODE_MODULES } from "./reasonCodes/registry";
import type { ReasonCodeGuidance, ReasonCodeModuleKey } from "./types";

export interface AdminPromptModuleRow {
  key: ReasonCodeModuleKey;
  displayName: string;
  reasonCodeKeys: string[];
  promptBody: string;
  guidanceJson: Record<string, unknown>;
  model: string | null;
  version: number;
  source: "db" | "file_default";
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function listPromptModules(): Promise<AdminPromptModuleRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("defence_prompt_modules")
    .select(
      "id, key, display_name, reason_code_keys, prompt_body, guidance_json, model, is_active, version, updated_by, updated_at",
    )
    .eq("is_active", true)
    .order("version", { ascending: false });

  type DbRow = {
    key: string;
    display_name: string;
    reason_code_keys: string[];
    prompt_body: string;
    guidance_json: Record<string, unknown>;
    model: string | null;
    version: number;
    updated_by: string | null;
    updated_at: string;
  };
  const latestByKey = new Map<string, DbRow>();
  for (const row of (data ?? []) as DbRow[]) {
    if (!latestByKey.has(row.key)) latestByKey.set(row.key, row);
  }

  return ALL_REASON_CODE_MODULES.map((mod) => {
    const dbRow = latestByKey.get(mod.key);
    return {
      key: mod.key,
      displayName: dbRow?.display_name ?? mod.displayName,
      reasonCodeKeys: mod.reasonCodeKeys,
      promptBody: dbRow?.prompt_body ?? mod.promptBody,
      guidanceJson:
        dbRow?.guidance_json ??
        ({
          prioritize: mod.prioritize,
          avoid: mod.avoid,
          mustNotClaim: mod.mustNotClaim,
          criticalCategories: mod.criticalCategories,
          allowedFactCategories: mod.allowedFactCategories,
        } as Record<string, unknown>),
      model: dbRow?.model ?? null,
      version: dbRow?.version ?? mod.version,
      source: dbRow ? "db" : "file_default",
      updatedAt: dbRow?.updated_at ?? null,
      updatedBy: dbRow?.updated_by ?? null,
    };
  });
}

export async function getPromptModule(key: string): Promise<AdminPromptModuleRow | null> {
  const modules = await listPromptModules();
  return modules.find((m) => m.key === key) ?? null;
}

export interface AdminRunRow {
  id: string;
  packageId: string | null;
  shopId: string | null;
  promptVersion: number | null;
  model: string | null;
  packageMode: "full" | "narrow" | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  validationStatus: "ok" | "failed" | "skipped" | "error" | null;
  createdAt: string;
}

export async function listRecentRuns(limit = 50): Promise<AdminRunRow[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("defence_package_runs")
    .select(
      "id, package_id, shop_id, prompt_version, model, package_mode, prompt_tokens, completion_tokens, duration_ms, validation_status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    packageId: (r.package_id as string | null) ?? null,
    shopId: (r.shop_id as string | null) ?? null,
    promptVersion: r.prompt_version as number | null,
    model: r.model as string | null,
    packageMode: r.package_mode as "full" | "narrow" | null,
    promptTokens: r.prompt_tokens as number | null,
    completionTokens: r.completion_tokens as number | null,
    durationMs: r.duration_ms as number | null,
    validationStatus: r.validation_status as "ok" | "failed" | "skipped" | "error" | null,
    createdAt: r.created_at as string,
  }));
}

export interface DashboardStats {
  totalRuns7d: number;
  okRate7d: number;
  failedCount7d: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgDurationMs: number;
  modulesActive: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const sb = getServiceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("defence_package_runs")
    .select("validation_status, prompt_tokens, completion_tokens, duration_ms")
    .gte("created_at", since);
  const rows = (data ?? []) as Array<{
    validation_status: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    duration_ms: number | null;
  }>;
  const total = rows.length;
  const ok = rows.filter((r) => r.validation_status === "ok").length;
  const failed = rows.filter((r) => r.validation_status === "failed").length;
  const avg = (sel: (r: typeof rows[number]) => number | null) => {
    const ns = rows.map(sel).filter((n): n is number => typeof n === "number");
    return ns.length === 0 ? 0 : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);
  };
  return {
    totalRuns7d: total,
    okRate7d: total === 0 ? 0 : Math.round((ok / total) * 100),
    failedCount7d: failed,
    avgPromptTokens: avg((r) => r.prompt_tokens),
    avgCompletionTokens: avg((r) => r.completion_tokens),
    avgDurationMs: avg((r) => r.duration_ms),
    modulesActive: ALL_REASON_CODE_MODULES.length,
  };
}

export type { ReasonCodeGuidance };
