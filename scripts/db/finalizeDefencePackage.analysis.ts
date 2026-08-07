/**
 * PR-C1 — the transactional lifecycle contract, tested against a REAL database.
 *
 * WHY THIS FILE EXISTS. Every claim in this area that was tested with a mocked
 * Supabase client turned out to be untestable in principle: "the update is
 * guarded", "the transition is atomic", "a newer version cannot slip in" are
 * statements about Postgres locking and transaction boundaries, and a mock
 * agrees with whatever you tell it. The previous revision even asserted the
 * guard by grepping the source for `.not("pdf_path","is",null)` — which passes
 * whether or not the predicate does anything. These are behavioural tests of
 * `finalize_defence_package` and `enqueue_defence_package_save`.
 *
 * DEV ONLY, AND SELF-CLEANING. It refuses to run against anything but the dev
 * project ref, creates its own fixture under a recognisable prefix, and
 * removes it afterwards. It is collected by `vitest.analysis.config.ts`, which
 * CI never runs — CI has no database credentials, and a database-reading job
 * must never be able to turn CI red.
 *
 * Run:
 *   npm run analysis:evidence -- scripts/db/finalizeDefencePackage.analysis.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const DEV_REF = "vrpkgudqmpyunekrkpnc";
const ENV_FILE = process.env.ANALYSIS_ENV_FILE ?? ".env.local";

function loadEnv(file: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), file), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    vars[t.slice(0, i).trim()] = v;
  }
  return vars;
}

const env = loadEnv(ENV_FILE);
const CONN = env.SUPABASE_URL_POSTGRES ?? "";

/** Hard guard. A destructive concurrency suite must never reach production. */
if (!CONN.includes(DEV_REF)) {
  throw new Error(
    `Refusing to run: ${ENV_FILE} SUPABASE_URL_POSTGRES does not point at the dev project (${DEV_REF}).`,
  );
}

const TAG = "prc1-txn-test";

async function connect(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

let db: pg.Client;
let shopId: string;
let disputeId: string;
let packId: string;

/** A fresh dispute + evidence pack + draft package, one per test. */
async function seedCase(): Promise<{ disputeId: string; packId: string; pkgId: string; revision: string }> {
  const d = await db.query<{ id: string }>(
    `insert into disputes (shop_id, dispute_gid, reason, status)
     values ($1, $2, 'FRAUDULENT', 'needs_response') returning id`,
    [shopId, `gid://${TAG}/${crypto.randomUUID()}`],
  );
  const dispute = d.rows[0].id;
  const p = await db.query<{ id: string }>(
    `insert into evidence_packs (shop_id, dispute_id, status) values ($1, $2, 'ready') returning id`,
    [shopId, dispute],
  );
  const pack = p.rows[0].id;
  const pkg = await db.query<{ id: string; content_revision: string }>(
    `insert into defence_packages
       (shop_id, dispute_id, source_pack_id, version, status, generated_by,
        evidence_hash, validation_status, pdf_path, facts_json, narrative_json)
     values ($1, $2, $3, 1, 'draft', 'system', $4, 'ok', 'dev/${TAG}/v1.pdf', '[]'::jsonb, '{}'::jsonb)
     returning id, content_revision`,
    [shopId, dispute, pack, `${TAG}-${crypto.randomUUID()}`],
  );
  return {
    disputeId: dispute,
    packId: pack,
    pkgId: pkg.rows[0].id,
    revision: pkg.rows[0].content_revision,
  };
}

async function finalize(
  client: pg.Client,
  pkgId: string,
  revision: string,
  version = 1,
  enqueue = true,
): Promise<Record<string, unknown>> {
  const r = await client.query<{ finalize_defence_package: Record<string, unknown> }>(
    `select finalize_defence_package($1::uuid, $2::uuid, $3::int, $4::boolean)`,
    [pkgId, revision, version, enqueue],
  );
  return r.rows[0].finalize_defence_package;
}

async function enqueueSave(
  client: pg.Client,
  pkgId: string,
  revision: string,
): Promise<Record<string, unknown>> {
  const r = await client.query<{ enqueue_defence_package_save: Record<string, unknown> }>(
    `select enqueue_defence_package_save($1::uuid, $2::uuid)`,
    [pkgId, revision],
  );
  return r.rows[0].enqueue_defence_package_save;
}

const statusOf = async (pkgId: string) =>
  (await db.query<{ status: string }>(`select status from defence_packages where id = $1`, [pkgId]))
    .rows[0]?.status;

const jobCount = async (pack: string) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*)::text as n from jobs where job_type = 'save_to_shopify' and entity_id = $1`,
        [pack],
      )
    ).rows[0].n,
  );

/**
 * Give a seeded case a PRIOR final at version 1 and move the candidate to
 * version 2. `defence_packages.version` carries a CHECK (>= 1), so the prior
 * cannot simply be version 0.
 */
async function withPriorFinal(
  c: { disputeId: string; packId: string; pkgId: string; revision: string },
  priorStatus: "final" | "submitted" = "final",
  tag = "prior",
): Promise<string> {
  // The candidate must move OFF version 1 first: (dispute_id, version) is
  // unique, and the candidate must also be the LATEST version for the
  // currency check to pass.
  await db.query(`update defence_packages set version = 2 where id = $1`, [c.pkgId]);
  const prior = await db.query<{ id: string }>(
    `insert into defence_packages
       (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash,
        validation_status, pdf_path)
     values ($1, $2, $3, 1, 'final', 'system', $4, 'ok', 'dev/prior.pdf') returning id`,
    [shopId, c.disputeId, c.packId, `${TAG}-${tag}-${crypto.randomUUID()}`],
  );
  if (priorStatus === "submitted") {
    await db.query(`update defence_packages set status = 'submitted' where id = $1`, [
      prior.rows[0].id,
    ]);
  }
  return prior.rows[0].id;
}

beforeAll(async () => {
  db = await connect();
  const s = await db.query<{ id: string }>(
    `insert into shops (shop_domain) values ($1) returning id`,
    [`${TAG}-${Date.now()}.myshopify.com`],
  );
  shopId = s.rows[0].id;
}, 120_000);

afterAll(async () => {
  if (db && shopId) {
    // shops → disputes → evidence_packs → defence_packages all cascade.
    await db.query(`delete from jobs where shop_id = $1`, [shopId]);
    await db.query(`delete from shops where id = $1`, [shopId]);
    await db.end();
  }
}, 120_000);

describe("finalize_defence_package — currency is inside the transaction", () => {
  it("the dispute lock actually blocks a concurrent package INSERT (the FK-lock claim)", async () => {
    // The whole currency guarantee rests on this: `for update` on the parent
    // dispute conflicts with the FOR KEY SHARE lock that inserting a
    // defence_packages row takes through defence_packages_dispute_id_fkey. If
    // that were not true, the lock would coordinate with nothing and a newer
    // version could still appear mid-transaction. Demonstrated, not asserted.
    const c = await seedCase();
    const holder = await connect();
    const inserter = await connect();
    try {
      await holder.query("begin");
      await holder.query(`select 1 from disputes where id = $1 for update`, [c.disputeId]);

      let insertDone = false;
      const insert = inserter
        .query(
          `insert into defence_packages
             (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
           values ($1, $2, $3, 2, 'draft', 'system', $4)`,
          [shopId, c.disputeId, c.packId, `${TAG}-blocked`],
        )
        .then(() => {
          insertDone = true;
        });

      await new Promise((r) => setTimeout(r, 1500));
      expect(insertDone, "the insert must be BLOCKED while the dispute row is locked").toBe(false);

      await holder.query("commit");
      await insert;
      expect(insertDone).toBe(true);
    } finally {
      await holder.end();
      await inserter.end();
    }
  }, 120_000);

  it("a newer version inserted before promotion makes the old candidate not_current", async () => {
    const c = await seedCase();
    await db.query(
      `insert into defence_packages
         (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
       values ($1, $2, $3, 2, 'draft', 'system', $4)`,
      [shopId, c.disputeId, c.packId, `${TAG}-v2`],
    );

    const out = await finalize(db, c.pkgId, c.revision);
    expect(out.outcome).toBe("conflict");
    expect(out.reason).toBe("not_current");
    expect(await statusOf(c.pkgId)).toBe("draft");
    expect(await jobCount(c.packId)).toBe(0);
  }, 120_000);
});

describe("finalize_defence_package — the inspected content must be unchanged", () => {
  const MUTATIONS: Array<[string, string, unknown]> = [
    ["facts_json", `update defence_packages set facts_json = $2 where id = $1`, JSON.stringify([{ id: "x" }])],
    ["narrative_json", `update defence_packages set narrative_json = $2 where id = $1`, JSON.stringify({ a: 1 })],
    ["pdf_path", `update defence_packages set pdf_path = $2 where id = $1`, "dev/other.pdf"],
    ["validation_status", `update defence_packages set validation_status = $2 where id = $1`, "failed"],
  ];

  for (const [field, sql, value] of MUTATIONS) {
    it(`a ${field} mutation after inspection prevents promotion`, async () => {
      const c = await seedCase();
      await db.query(sql, [c.pkgId, value]);
      const out = await finalize(db, c.pkgId, c.revision);
      expect(out.outcome).toBe("conflict");
      // validation_status also fails its own precondition; either refusal is
      // correct, but the content check is what must fire first.
      expect(["content_changed", "validation_not_ok"]).toContain(out.reason);
      expect(await statusOf(c.pkgId)).toBe("draft");
      expect(await jobCount(c.packId)).toBe(0);
    }, 120_000);
  }

  it("content_revision moves on every inspected field and on nothing else", async () => {
    const c = await seedCase();
    // A status-only write must NOT move the revision, or every promotion would
    // invalidate itself.
    await db.query(`update defence_packages set generated_by = 'admin' where id = $1`, [c.pkgId]);
    const same = await db.query<{ content_revision: string }>(
      `select content_revision from defence_packages where id = $1`,
      [c.pkgId],
    );
    expect(same.rows[0].content_revision).toBe(c.revision);

    await db.query(`update defence_packages set facts_json = '[{"a":1}]'::jsonb where id = $1`, [c.pkgId]);
    const moved = await db.query<{ content_revision: string }>(
      `select content_revision from defence_packages where id = $1`,
      [c.pkgId],
    );
    expect(moved.rows[0].content_revision).not.toBe(c.revision);
  }, 120_000);
});

describe("finalize_defence_package — PDF path is TRIMMED, not just non-null", () => {
  for (const [label, value] of [
    ["null", null],
    ["empty string", ""],
    ["whitespace only", "   "],
  ] as Array<[string, string | null]>) {
    it(`refuses a ${label} pdf_path`, async () => {
      const c = await seedCase();
      await db.query(`update defence_packages set pdf_path = $2 where id = $1`, [c.pkgId, value]);
      const rev = (
        await db.query<{ content_revision: string }>(
          `select content_revision from defence_packages where id = $1`,
          [c.pkgId],
        )
      ).rows[0].content_revision;

      const out = await finalize(db, c.pkgId, rev);
      expect(out.outcome).toBe("conflict");
      expect(out.reason).toBe("missing_pdf");
      expect(await statusOf(c.pkgId)).toBe("draft");
    }, 120_000);
  }
});

describe("finalize_defence_package — concurrency and idempotency", () => {
  it("two concurrent finalizers promote exactly once and enqueue exactly one job", async () => {
    const c = await seedCase();
    const a = await connect();
    const b = await connect();
    try {
      const [ra, rb] = await Promise.all([
        finalize(a, c.pkgId, c.revision),
        finalize(b, c.pkgId, c.revision),
      ]);
      const outcomes = [ra.outcome, rb.outcome].sort();
      // Exactly one promotion. The loser converges on `already_done` rather
      // than a spurious failure — same revision, same committed effect.
      expect(outcomes.filter((o) => o === "promoted")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already_done")).toHaveLength(1);
      expect(await statusOf(c.pkgId)).toBe("final");
      expect(await jobCount(c.packId)).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  }, 120_000);

  it("a replayed call after a lost response creates no duplicate job", async () => {
    const c = await seedCase();
    const first = await finalize(db, c.pkgId, c.revision);
    expect(first.outcome).toBe("promoted");
    const replay = await finalize(db, c.pkgId, c.revision);
    expect(replay.outcome).toBe("already_done");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);
});

describe("finalize_defence_package — the prior final", () => {
  it("supersedes a prior FINAL", async () => {
    const c = await seedCase();
    const priorId = await withPriorFinal(c, "final");
    const out = await finalize(db, c.pkgId, c.revision, 2);
    expect(out.outcome).toBe("promoted");
    expect(out.superseded_id).toBe(priorId);
    expect(await statusOf(priorId)).toBe("superseded");
  }, 120_000);

  it("NEVER overwrites a prior package that has become SUBMITTED", async () => {
    const c = await seedCase();
    // The worker files the prior version while the merchant reviews the draft.
    const priorId = await withPriorFinal(c, "submitted", "prior-submitted");

    const out = await finalize(db, c.pkgId, c.revision, 2);
    expect(out.outcome).toBe("promoted");
    expect(out.superseded_id).toBeNull();
    expect(await statusOf(priorId)).toBe("submitted");
    const sup = await db.query<{ superseded_by_id: string | null }>(
      `select superseded_by_id from defence_packages where id = $1`,
      [priorId],
    );
    expect(sup.rows[0].superseded_by_id).toBeNull();
  }, 120_000);
});

describe("finalize_defence_package — a failed enqueue rolls the whole thing back", () => {
  it("promotion and supersession are undone, and the draft can genuinely retry", async () => {
    const c = await seedCase();
    const priorId = await withPriorFinal(c, "final", "rollback-prior");

    // Inject the failure at the LAST step of the transaction.
    await db.query(`
      create or replace function prc1_txn_test_fail_job_insert() returns trigger
      language plpgsql as $fn$
      begin
        raise exception 'injected job-insert failure';
      end;
      $fn$;
    `);
    await db.query(
      `create trigger zz_prc1_txn_test_fail
         before insert on jobs
         for each row
         when (new.entity_id = '${c.packId}')
         execute function prc1_txn_test_fail_job_insert();`,
    );

    try {
      await expect(finalize(db, c.pkgId, c.revision, 2)).rejects.toThrow(
        /injected job-insert failure/,
      );

      // EVERYTHING rolled back — promotion AND supersession.
      expect(await statusOf(c.pkgId)).toBe("draft");
      expect(await statusOf(priorId)).toBe("final");
      expect(await jobCount(c.packId)).toBe(0);
    } finally {
      await db.query(`drop trigger if exists zz_prc1_txn_test_fail on jobs`);
      await db.query(`drop function if exists prc1_txn_test_fail_job_insert()`);
    }

    // …and the retry genuinely works, which the pre-transaction code could not
    // do: it left a `final` package the rebuild refused and reconciliation
    // skipped, so the "retriable" result could never actually retry.
    const retry = await finalize(db, c.pkgId, c.revision, 2);
    expect(retry.outcome).toBe("promoted");
    expect(await statusOf(c.pkgId)).toBe("final");
    expect(await statusOf(priorId)).toBe("superseded");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);
});

describe("enqueue_defence_package_save — the direct Submit path", () => {
  async function seedFinal() {
    const c = await seedCase();
    const out = await finalize(db, c.pkgId, c.revision, 1, false);
    expect(out.outcome).toBe("promoted");
    return c;
  }

  it("enqueues for a current, fileable final package", async () => {
    const c = await seedFinal();
    const out = await enqueueSave(db, c.pkgId, c.revision);
    expect(out.outcome).toBe("enqueued");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);

  it("refuses after a concurrent CURRENCY change", async () => {
    const c = await seedFinal();
    await db.query(
      `insert into defence_packages
         (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
       values ($1, $2, $3, 5, 'draft', 'system', $4)`,
      [shopId, c.disputeId, c.packId, `${TAG}-newer`],
    );
    const out = await enqueueSave(db, c.pkgId, c.revision);
    expect(out.outcome).toBe("conflict");
    expect(out.reason).toBe("not_current");
    expect(await jobCount(c.packId)).toBe(0);
  }, 120_000);

  it("refuses after a REAL content change (not a hand-rotated revision)", async () => {
    // Mutate genuine inspected content while the candidate is still a draft,
    // let the trigger move the revision, promote at the NEW revision, then
    // present the OLD one — exactly what a caller holding a stale inspection
    // would do. The earlier version of this test rotated `content_revision`
    // by hand, which the hardened trigger now (correctly) ignores.
    const c = await seedCase();
    await db.query(`update defence_packages set facts_json = '[{"a":1}]'::jsonb where id = $1`, [
      c.pkgId,
    ]);
    const fresh = (
      await db.query<{ content_revision: string }>(
        `select content_revision from defence_packages where id = $1`,
        [c.pkgId],
      )
    ).rows[0].content_revision;
    expect(fresh).not.toBe(c.revision);
    expect((await finalize(db, c.pkgId, fresh, 1, false)).outcome).toBe("promoted");

    const out = await enqueueSave(db, c.pkgId, c.revision);
    expect(out.outcome).toBe("conflict");
    expect(out.reason).toBe("content_changed");
    expect(await jobCount(c.packId)).toBe(0);
  }, 120_000);

  it("is idempotent while a save is already in flight", async () => {
    const c = await seedFinal();
    expect((await enqueueSave(db, c.pkgId, c.revision)).outcome).toBe("enqueued");
    const again = await enqueueSave(db, c.pkgId, c.revision);
    expect(again.outcome).toBe("already_done");
    expect(again.reason).toBe("save_already_queued");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);
});


/* ── Concurrent UPDATES, not sequential mutations ─────────────────────────
 *
 * The parent-dispute lock blocks INSERTs. It does NOT serialize updates to
 * existing package rows, so the first cut still had this race: A rewrites the
 * candidate's content and holds it uncommitted; B enters the RPC, locks the
 * dispute, reads the OLD committed revision, validates it, reaches the
 * promotion UPDATE and blocks on A; A commits; B resumes and `status='draft'`
 * still matches, so B promotes content it never inspected.
 *
 * These tests hold a real uncommitted write open while the RPC runs, which is
 * the only way to observe that. A sequential mutation cannot.
 * --------------------------------------------------------------------- */

/**
 * Hold `sql` uncommitted in its own connection, run `body`, then commit the
 * holder. Returns whatever `body` resolved to.
 */
async function whileUncommitted<T>(
  sql: string,
  params: unknown[],
  body: () => Promise<T>,
): Promise<T> {
  const holder = await connect();
  try {
    await holder.query("begin");
    await holder.query(sql, params);
    // Give the RPC time to reach — and block on — the row lock.
    const started = body();
    await new Promise((r) => setTimeout(r, 800));
    await holder.query("commit");
    return await started;
  } finally {
    await holder.end();
  }
}

describe("finalize_defence_package — concurrent UNCOMMITTED updates", () => {
  const CASES: Array<[string, (pkgId: string) => [string, unknown[]], string]> = [
    [
      "facts_json rewritten and held uncommitted",
      (id) => [`update defence_packages set facts_json = '[{"z":9}]'::jsonb where id = $1`, [id]],
      "content_changed",
    ],
    [
      "pdf_path rewritten and held uncommitted",
      (id) => [`update defence_packages set pdf_path = 'dev/other.pdf' where id = $1`, [id]],
      "content_changed",
    ],
    [
      "validation_status invalidated and held uncommitted",
      (id) => [`update defence_packages set validation_status = 'failed' where id = $1`, [id]],
      "content_changed",
    ],
    [
      "the candidate's own version changed and held uncommitted",
      (id) => [`update defence_packages set version = 7 where id = $1`, [id]],
      "version_mismatch",
    ],
  ];

  for (const [name, mutation, expectedReason] of CASES) {
    it(`waits, re-reads and refuses: ${name}`, async () => {
      const c = await seedCase();
      const [sql, params] = mutation(c.pkgId);
      const runner = await connect();
      try {
        const out = await whileUncommitted(sql, params, () =>
          finalize(runner, c.pkgId, c.revision, 1, true),
        );
        expect(out.outcome).toBe("conflict");
        expect(out.reason).toBe(expectedReason);
        expect(await statusOf(c.pkgId)).toBe("draft");
        expect(await jobCount(c.packId)).toBe(0);
      } finally {
        await runner.end();
      }
    }, 120_000);
  }

  it("waits and refuses when ANOTHER row's version change makes it the latest", async () => {
    const c = await seedCase();
    // A sibling at version 0 is not the latest… until it is.
    await db.query(`update defence_packages set version = 2 where id = $1`, [c.pkgId]);
    const sibling = await db.query<{ id: string }>(
      `insert into defence_packages
         (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
       values ($1, $2, $3, 1, 'draft', 'system', $4) returning id`,
      [shopId, c.disputeId, c.packId, `${TAG}-sibling-${crypto.randomUUID()}`],
    );

    const runner = await connect();
    try {
      const out = await whileUncommitted(
        `update defence_packages set version = 9 where id = $1`,
        [sibling.rows[0].id],
        () => finalize(runner, c.pkgId, c.revision, 2, true),
      );
      expect(out.outcome).toBe("conflict");
      expect(out.reason).toBe("not_current");
      expect(await statusOf(c.pkgId)).toBe("draft");
      expect(await jobCount(c.packId)).toBe(0);
    } finally {
      await runner.end();
    }
  }, 120_000);

  it("direct Submit also waits and refuses on a concurrent uncommitted change", async () => {
    const c = await seedCase();
    expect((await finalize(db, c.pkgId, c.revision, 1, false)).outcome).toBe("promoted");
    // A `final` row's content is immutable, so the observable concurrent change
    // is a sibling becoming the latest version.
    const sibling = await db.query<{ id: string }>(
      `insert into defence_packages
         (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
       values ($1, $2, $3, 2, 'draft', 'system', $4) returning id`,
      [shopId, c.disputeId, c.packId, `${TAG}-submit-sibling-${crypto.randomUUID()}`],
    );
    const runner = await connect();
    try {
      const out = await whileUncommitted(
        `update defence_packages set version = 11 where id = $1`,
        [sibling.rows[0].id],
        () => enqueueSave(runner, c.pkgId, c.revision),
      );
      expect(out.outcome).toBe("conflict");
      expect(out.reason).toBe("not_current");
      expect(await jobCount(c.packId)).toBe(0);
    } finally {
      await runner.end();
    }
  }, 120_000);
});

/* ── content_revision is owned by the database ────────────────────────────
 *
 * Previously the trigger only GENERATED a revision when content changed; it
 * accepted a direct assignment otherwise. So "changes if and only if the
 * inspected fields change" was false, and the analysis script itself used the
 * bypass.
 * --------------------------------------------------------------------- */

describe("content_revision cannot be spoofed", () => {
  it("an explicit assignment on a no-op update is ignored", async () => {
    const c = await seedCase();
    await db.query(
      `update defence_packages set content_revision = gen_random_uuid() where id = $1`,
      [c.pkgId],
    );
    const after = (
      await db.query<{ content_revision: string }>(
        `select content_revision from defence_packages where id = $1`,
        [c.pkgId],
      )
    ).rows[0].content_revision;
    expect(after).toBe(c.revision);
  });

  it("a caller cannot change content AND hold the old revision", async () => {
    const c = await seedCase();
    await db.query(
      `update defence_packages
          set facts_json = '[{"spoof":true}]'::jsonb,
              content_revision = $2
        where id = $1`,
      [c.pkgId, c.revision],
    );
    const after = (
      await db.query<{ content_revision: string }>(
        `select content_revision from defence_packages where id = $1`,
        [c.pkgId],
      )
    ).rows[0].content_revision;
    expect(after).not.toBe(c.revision);
    // …and the stale revision is refused, so the spoof buys nothing.
    const out = await finalize(db, c.pkgId, c.revision);
    expect(out.outcome).toBe("conflict");
    expect(out.reason).toBe("content_changed");
  });

  it("an unrelated mutation preserves the revision", async () => {
    const c = await seedCase();
    await db.query(`update defence_packages set generated_by = 'merchant' where id = $1`, [c.pkgId]);
    const after = (
      await db.query<{ content_revision: string }>(
        `select content_revision from defence_packages where id = $1`,
        [c.pkgId],
      )
    ).rows[0].content_revision;
    expect(after).toBe(c.revision);
  });
});

/* ── Only the RPC may promote ─────────────────────────────────────────── */

describe("direct draft → final is rejected", () => {
  it("a plain UPDATE cannot promote", async () => {
    const c = await seedCase();
    await expect(
      db.query(`update defence_packages set status = 'final' where id = $1`, [c.pkgId]),
    ).rejects.toThrow(/must go through finalize_defence_package/);
    expect(await statusOf(c.pkgId)).toBe("draft");
  }, 120_000);

  it("a plain UPDATE cannot promote a STALE candidate either", async () => {
    const c = await seedCase();
    await db.query(`update defence_packages set status = 'stale' where id = $1`, [c.pkgId]);
    await expect(
      db.query(`update defence_packages set status = 'final' where id = $1`, [c.pkgId]),
    ).rejects.toThrow(/must go through finalize_defence_package/);
    expect(await statusOf(c.pkgId)).toBe("stale");
  }, 120_000);

  it("the RPC promotes, and the grant does not leak to a later update", async () => {
    const c = await seedCase();
    expect((await finalize(db, c.pkgId, c.revision, 1, false)).outcome).toBe("promoted");
    expect(await statusOf(c.pkgId)).toBe("final");

    // Same session, a fresh draft: the grant was cleared, so this is refused.
    const other = await seedCase();
    await expect(
      db.query(`update defence_packages set status = 'final' where id = $1`, [other.pkgId]),
    ).rejects.toThrow(/must go through finalize_defence_package/);
  }, 120_000);

  it("legitimate final → submitted and final → superseded still work", async () => {
    const c = await seedCase();
    expect((await finalize(db, c.pkgId, c.revision, 1, false)).outcome).toBe("promoted");
    await db.query(`update defence_packages set status = 'submitted' where id = $1`, [c.pkgId]);
    expect(await statusOf(c.pkgId)).toBe("submitted");

    const c2 = await seedCase();
    const prior = await withPriorFinal(c2, "final", "supersede-ok");
    expect((await finalize(db, c2.pkgId, c2.revision, 2, false)).outcome).toBe("promoted");
    expect(await statusOf(prior)).toBe("superseded");
  }, 120_000);

  it("the deadline cron's stale auto-finalize still works through the RPC", async () => {
    const c = await seedCase();
    await db.query(`update defence_packages set status = 'stale' where id = $1`, [c.pkgId]);
    const r = await db.query<{ finalize_defence_package: Record<string, unknown> }>(
      `select finalize_defence_package($1::uuid, $2::uuid, $3::int, $4::boolean, $5::text[])`,
      [c.pkgId, c.revision, 1, true, ["draft", "stale"]],
    );
    expect(r.rows[0].finalize_defence_package.outcome).toBe("promoted");
    expect(await statusOf(c.pkgId)).toBe("final");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);
});

/* ── The already_done branch cannot bypass validation ─────────────────── */

describe("idempotent replay is still validated", () => {
  it("a STALE final with a matching revision is refused, not handed a job", async () => {
    const c = await seedCase();
    expect((await finalize(db, c.pkgId, c.revision, 1, false)).outcome).toBe("promoted");
    // A newer version lands after the promotion.
    await db.query(
      `insert into defence_packages
         (shop_id, dispute_id, source_pack_id, version, status, generated_by, evidence_hash)
       values ($1, $2, $3, 4, 'draft', 'system', $4)`,
      [shopId, c.disputeId, c.packId, `${TAG}-newer-${crypto.randomUUID()}`],
    );

    const replay = await finalize(db, c.pkgId, c.revision, 1, true);
    expect(replay.outcome).toBe("conflict");
    expect(replay.reason).toBe("not_current");
    expect(await jobCount(c.packId)).toBe(0);
  }, 120_000);

  it("a replay NAMES the job so the caller can prove the save exists", async () => {
    const c = await seedCase();
    expect((await finalize(db, c.pkgId, c.revision)).outcome).toBe("promoted");
    const replay = await finalize(db, c.pkgId, c.revision);
    expect(replay.outcome).toBe("already_done");
    expect(typeof replay.job_id).toBe("string");
    expect(await jobCount(c.packId)).toBe(1);
  }, 120_000);
});


/* ── The promotion SOURCE allow-list is constrained ───────────────────────
 *
 * `p_allowed_statuses` exists so the deadline cron can auto-finalize a
 * `stale` candidate. Nothing stopped a service-role caller from passing
 * `{superseded}` or `{failed}` and promoting from a state the lifecycle has
 * no business promoting from, which quietly undid the trigger's boundary.
 * --------------------------------------------------------------------- */

async function finalizeWithStatuses(
  pkgId: string,
  revision: string,
  version: number,
  statuses: unknown,
): Promise<Record<string, unknown>> {
  const r = await db.query<{ finalize_defence_package: Record<string, unknown> }>(
    `select finalize_defence_package($1::uuid, $2::uuid, $3::int, false, $4::text[])`,
    [pkgId, revision, version, statuses],
  );
  return r.rows[0].finalize_defence_package;
}

describe("finalize_defence_package — p_allowed_statuses is validated", () => {
  const REJECTED: Array<[string, unknown]> = [
    ["submitted", ["submitted"]],
    ["superseded", ["superseded"]],
    ["failed", ["failed"]],
    ["skipped", ["skipped"]],
    ["final", ["final"]],
    ["an arbitrary string", ["whatever"]],
    ["draft plus an illegal status", ["draft", "superseded"]],
    ["an empty array", []],
    ["a null element", [null]],
    ["null", null],
  ];

  for (const [name, statuses] of REJECTED) {
    it(`refuses ${name} without mutating`, async () => {
      const c = await seedCase();
      const out = await finalizeWithStatuses(c.pkgId, c.revision, 1, statuses);
      expect(out.outcome).toBe("conflict");
      expect(out.reason).toBe("invalid_allowed_statuses");
      expect(await statusOf(c.pkgId)).toBe("draft");
      expect(await jobCount(c.packId)).toBe(0);
    }, 120_000);
  }

  it("still accepts the two sanctioned sets", async () => {
    const a = await seedCase();
    expect((await finalizeWithStatuses(a.pkgId, a.revision, 1, ["draft"])).outcome).toBe("promoted");

    const b = await seedCase();
    await db.query(`update defence_packages set status = 'stale' where id = $1`, [b.pkgId]);
    expect(
      (await finalizeWithStatuses(b.pkgId, b.revision, 1, ["draft", "stale"])).outcome,
    ).toBe("promoted");
  }, 120_000);
});

describe("EVERY non-final → final needs the grant", () => {
  for (const from of ["draft", "stale", "failed", "skipped"]) {
    it(`a direct ${from} → final UPDATE is rejected`, async () => {
      const c = await seedCase();
      if (from !== "draft") {
        await db.query(`update defence_packages set status = $2 where id = $1`, [c.pkgId, from]);
      }
      await expect(
        db.query(`update defence_packages set status = 'final' where id = $1`, [c.pkgId]),
      ).rejects.toThrow(/must go through finalize_defence_package/);
      expect(await statusOf(c.pkgId)).toBe(from);
    }, 120_000);
  }

  it("but a `failed` row still cannot be promoted BY the RPC either", async () => {
    // The allow-list refuses the source, so widening the trigger did not open
    // a new door — it closed a side one.
    const c = await seedCase();
    await db.query(`update defence_packages set status = 'failed' where id = $1`, [c.pkgId]);
    const out = await finalizeWithStatuses(c.pkgId, c.revision, 1, ["draft", "stale"]);
    expect(out.outcome).toBe("conflict");
    expect(out.reason).toBe("not_draft");
    expect(await statusOf(c.pkgId)).toBe("failed");
  }, 120_000);
});
