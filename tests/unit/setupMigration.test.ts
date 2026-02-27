import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("setup wizard migration SQL", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/020_setup_wizard.sql"),
    "utf8"
  );

  it("creates shop_setup table", () => {
    expect(sql).toContain("create table shop_setup");
    expect(sql).toContain("shop_id");
    expect(sql).toContain("steps");
    expect(sql).toContain("jsonb");
  });

  it("creates integrations table with unique constraint", () => {
    expect(sql).toContain("create table integrations");
    expect(sql).toContain("unique(shop_id, type)");
  });

  it("creates integration_secrets table", () => {
    expect(sql).toContain("create table integration_secrets");
    expect(sql).toContain("secret_enc");
  });

  it("creates evidence_files table", () => {
    expect(sql).toContain("create table evidence_files");
    expect(sql).toContain("storage_path");
    expect(sql).toContain("mime_type");
    expect(sql).toContain("size_bytes");
  });

  it("creates app_events table", () => {
    expect(sql).toContain("create table app_events");
    expect(sql).toMatch(/name\s+text/);
    expect(sql).toMatch(/payload\s+jsonb/);
  });

  it("enables RLS on all tables", () => {
    const rlsCount = (sql.match(/enable row level security/g) || []).length;
    expect(rlsCount).toBe(5);
  });

  it("creates indexes", () => {
    expect(sql).toContain("idx_shop_setup_updated");
    expect(sql).toContain("idx_integrations_shop");
    expect(sql).toContain("idx_evidence_files_shop");
    expect(sql).toContain("idx_app_events_shop");
    expect(sql).toContain("idx_app_events_name");
  });

  it("references shops table via foreign keys", () => {
    expect(sql).toContain("references shops(id)");
  });

  it("mentions evidence-samples bucket", () => {
    expect(sql).toContain("evidence-samples");
  });
});
