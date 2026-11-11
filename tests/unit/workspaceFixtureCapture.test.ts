/**
 * The fixture capture tooling and the shared enrichment path
 * (single-source plan 3.1): the scrubber leaves no PII, the PostgREST->SQL
 * translator only ever produces SELECTs, and `enrichWorkspacePayload` is the
 * one place a payload field is added.
 */
import { describe, expect, it } from "vitest";
import { buildSelectSql, splitTop, type ForeignKey } from "../../scripts/fixtures/lib/postgrestSql";
import { findLeaks, scrubFixture } from "../../scripts/fixtures/lib/scrub";
import { ENRICHED_PATHS, enrichWorkspacePayload } from "@/lib/disputes/workspacePayload/enrich";
import { loadFixtures } from "../harness/fixtures";

describe("fixture scrubber", () => {
  const raw = {
    shopDomain: "acme-test.myshopify.com",
    payload: {
      dispute: {
        customerName: "Maria Svensson",
        orderName: "#17066",
        orderGid: "gid://shopify/Order/5551234567890",
        shopId: "d595d90a-8130-4995-84e9-c8dd59db022b",
      },
      note: "Maria Svensson (maria.svensson@example.com) from 192.168.4.20 ordered #17066, see https://acme-test.myshopify.com/admin",
      address: { address1: "Storgatan 12", city: "Malmo", phone: "+46 70 123 45 67" },
      trackingLine: "tracking 6123089614",
      tracking: [{ number: "6123089614" }],
    },
  };
  const { json, literals } = scrubFixture(raw, ["acme-test.myshopify.com"]);
  const text = JSON.stringify(json);

  it("replaces names, emails, IPs, order numbers, GIDs, domains, addresses, phones, tracking numbers and shop ids", () => {
    for (const secret of [
      "Maria", "Svensson", "maria.svensson", "192.168.4.20", "17066", "5551234567890", "acme-test",
      "Storgatan", "Malmo", "123 45 67", "6123089614", "d595d90a",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("the leak check passes on scrubbed output and catches a planted leak", () => {
    expect(findLeaks(text, literals)).toEqual([]);
    expect(findLeaks(text + " mail me at someone@real.example", literals)).not.toEqual([]);
    expect(findLeaks(text + " Storgatan", literals)).not.toEqual([]);
    expect(findLeaks(text + " gid://shopify/Order/999", literals)).not.toEqual([]);
    for (const brand of ["Blume", "Hem & Trend", "Mein Maison", "real-shop.myshopify.com"]) {
      expect(findLeaks(text + ` ${brand}`, literals), brand).not.toEqual([]);
    }
  });

  it("keeps structure: same keys, scrubbed values stay strings", () => {
    const out = json as typeof raw;
    expect(Object.keys(out.payload.dispute)).toEqual(Object.keys(raw.payload.dispute));
    expect(typeof out.payload.dispute.customerName).toBe("string");
  });

  it("the committed fixtures carry no email, IP or Shopify GID", () => {
    for (const f of loadFixtures()) {
      expect(findLeaks(JSON.stringify(f), []), f.meta.case).toEqual([]);
    }
  });
});

describe("PostgREST -> SQL translation for the read-only capture", () => {
  const fks: ForeignKey[] = [{ table: "disputes", cols: ["shop_id"], ftable: "shops", fcols: ["id"] }];
  const build = (table: string, qs: string, extra: { accept?: string; range?: string } = {}) =>
    buildSelectSql(table, new URLSearchParams(qs), extra, fks);

  it("builds a filtered, ordered, limited select", () => {
    const q = build("audit_events", "select=event_payload,created_at&dispute_id=eq.abc&event_type=eq.rule_applied&order=created_at.desc&limit=1");
    expect(q.sql).toContain(`from "audit_events" b where b."dispute_id" = 'abc' and b."event_type" = 'rule_applied' order by b."created_at" desc limit 1`);
    expect(q.sql).toMatch(/^select coalesce\(json_agg\(t\)/);
  });

  it("handles in(), is.null, not., or groups and json paths", () => {
    const q = build("jobs", `status=in.(queued,running)&entity_id=is.null&kind=not.eq.x&or=(a.eq.1,b.is.null)&payload->>k=eq.v`);
    expect(q.sql).toContain(`b."status" in ('queued', 'running')`);
    expect(q.sql).toContain(`b."entity_id" is null`);
    expect(q.sql).toContain(`not (b."kind" = 'x')`);
    expect(q.sql).toContain(`(b."a" = '1' or b."b" is null)`);
    expect(q.sql).toContain(`b."payload"->>'k' = 'v'`);
  });

  it("embeds a to-one relation through the foreign key", () => {
    const q = build("disputes", "select=*,shops(shop_domain,primary_domain)&id=eq.x");
    expect(q.sql).toContain(`from "shops" r1 where r1."id" = b."shop_id" limit 1`);
    expect(q.sql).toContain(`as "shops"`);
  });

  it("escapes quotes in values", () => {
    expect(build("t", "name=eq.O'Neil").sql).toContain(`'O''Neil'`);
  });

  it("flags single-object requests", () => {
    expect(build("t", "id=eq.1", { accept: "application/vnd.pgrst.object+json" }).singleObject).toBe(true);
    expect(build("t", "id=eq.1").singleObject).toBe(false);
  });

  it("only ever emits a SELECT", () => {
    const q = build("t", "select=*&a=eq.1;drop table t");
    expect(q.sql).toMatch(/^select /);
    expect(q.sql).toContain(`'1;drop table t'`);
  });

  it("splitTop respects nesting and quotes", () => {
    expect(splitTop(`a,b(c,d),"e,f"`)).toEqual(["a", "b(c,d)", `"e,f"`]);
  });
});

describe("enrichWorkspacePayload (the one enrichment path)", () => {
  it("adds only the paths it declares", () => {
    expect(ENRICHED_PATHS).toEqual(["asks", "outcomeExplanation"]);
    for (const f of loadFixtures()) {
      const before = JSON.stringify(f.payload);
      const out = enrichWorkspacePayload(JSON.parse(before), f.sourceRows) as Record<string, unknown>;
      const { asks, outcomeExplanation: _ox, ...rest } = out;
      expect(Array.isArray(asks), f.meta.case).toBe(true);
      expect(JSON.stringify(rest), f.meta.case).toBe(before);
    }
  });

  it("every fixture carries all four source-row fields", () => {
    for (const f of loadFixtures()) {
      expect(Object.keys(f.sourceRows).sort(), f.meta.case).toEqual(
        ["assessmentReadOk", "automationMode", "evidenceSavedToShopifyAt", "outcomeInputs"],
      );
    }
  });

  it("the fixture set is the seven cases of plan 3.1", () => {
    expect(loadFixtures().map((f) => f.meta.case).sort()).toEqual([
      "17066-returned-to-sender",
      "21037-return-in-progress",
      "23750-stamped-saved-save-failed",
      "24285-latest-build-failed",
      "24612-return-received-cnp-won",
      "review-awaiting",
      "won-filed",
    ]);
  });
});
