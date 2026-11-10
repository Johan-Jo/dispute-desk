/**
 * PostgREST request -> read-only SQL, for the fixture capture script.
 *
 * The capture script runs the REAL workspace route against production data
 * without holding a service-role key: `supabase-js` builds ordinary PostgREST
 * URLs, a replacement `fetch` turns each GET into a SELECT, and the SELECT goes
 * through `npm run db:query:prod -- --read-only` (the guarded, read-only path).
 * Any non-GET request is refused here, so a write cannot be expressed at all.
 *
 * Supports the subset the workspace route uses: select (aliases, casts, json
 * paths, embedded to-one / to-many relations), eq/neq/gt/gte/lt/lte/like/ilike/
 * is/in/cs/cd filters, not., or=/and= groups, order, limit, offset, Range.
 */

export interface ForeignKey {
  table: string;
  cols: string[];
  ftable: string;
  fcols: string[];
}

export const FK_SQL = `select coalesce(json_agg(json_build_object(
  'table', c.conrelid::regclass::text,
  'ftable', c.confrelid::regclass::text,
  'cols', (select json_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum),
  'fcols', (select json_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
)), '[]'::json) as j from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace;`;

const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** Split on `sep` at nesting depth 0 (parentheses, braces, double quotes). */
export function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") depth--;
      else if (ch === sep && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** `a->b->>c` -> SQL expression over `base`; returns the expression and the result name. */
function columnExpr(base: string, raw: string): { expr: string; name: string } {
  const parts = raw.split(/(->>|->)/);
  const col = parts[0];
  let expr = `${base}.${q(col)}`;
  let name = col;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const key = parts[i + 1];
    expr += `${op}${/^\d+$/.test(key) ? key : lit(key)}`;
    name = key;
  }
  return { expr, name };
}

function filterSql(base: string, rawCol: string, rawVal: string): string {
  let val = rawVal;
  let negate = false;
  if (val.startsWith("not.")) {
    negate = true;
    val = val.slice(4);
  }
  const dot = val.indexOf(".");
  const op = dot === -1 ? val : val.slice(0, dot);
  const arg = dot === -1 ? "" : val.slice(dot + 1);
  const { expr } = columnExpr(base, rawCol);
  let sql: string;
  switch (op) {
    case "eq": sql = `${expr} = ${lit(arg)}`; break;
    case "neq": sql = `${expr} <> ${lit(arg)}`; break;
    case "gt": sql = `${expr} > ${lit(arg)}`; break;
    case "gte": sql = `${expr} >= ${lit(arg)}`; break;
    case "lt": sql = `${expr} < ${lit(arg)}`; break;
    case "lte": sql = `${expr} <= ${lit(arg)}`; break;
    case "like": sql = `${expr} like ${lit(arg.replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${expr} ilike ${lit(arg.replace(/\*/g, "%"))}`; break;
    case "is": sql = `${expr} is ${arg === "null" ? "null" : arg === "true" ? "true" : "false"}`; break;
    case "in": {
      const inner = arg.replace(/^\(/, "").replace(/\)$/, "");
      const items = splitTop(inner).map((x) => lit(x.replace(/^"(.*)"$/, "$1")));
      sql = items.length === 0 ? "false" : `${expr} in (${items.join(", ")})`;
      break;
    }
    case "cs": sql = `${expr} @> ${lit(arg)}`; break;
    case "cd": sql = `${expr} <@ ${lit(arg)}`; break;
    default:
      throw new Error(`postgrestSql: unsupported operator "${op}" on ${rawCol}`);
  }
  return negate ? `not (${sql})` : sql;
}

function logicSql(base: string, kind: "or" | "and", body: string): string {
  const inner = body.replace(/^\(/, "").replace(/\)$/, "");
  const parts = splitTop(inner).map((item) => {
    const m = /^(or|and)(\(.*\))$/.exec(item);
    if (m) return logicSql(base, m[1] as "or" | "and", m[2]);
    const firstDot = item.indexOf(".");
    return filterSql(base, item.slice(0, firstDot), item.slice(firstDot + 1));
  });
  return `(${parts.join(kind === "or" ? " or " : " and ")})`;
}

interface Ctx {
  fks: ForeignKey[];
  n: number;
}

function parseSelectItem(item: string): {
  alias: string | null;
  name: string;
  hint: string | null;
  inner: boolean;
  children: string | null;
  cast: string | null;
} {
  let rest = item.trim();
  let alias: string | null = null;
  const aliasM = /^([A-Za-z0-9_]+):(?!:)(.*)$/.exec(rest);
  if (aliasM) {
    alias = aliasM[1];
    rest = aliasM[2];
  }
  let children: string | null = null;
  const paren = rest.indexOf("(");
  if (paren !== -1 && rest.endsWith(")")) {
    children = rest.slice(paren + 1, -1);
    rest = rest.slice(0, paren);
  }
  let hint: string | null = null;
  let inner = false;
  const bang = rest.split("!");
  rest = bang[0];
  for (const b of bang.slice(1)) {
    if (b === "inner") inner = true;
    else if (b === "left") inner = false;
    else hint = b;
  }
  let cast: string | null = null;
  const castM = /^(.*)::([A-Za-z0-9_ ]+)$/.exec(rest);
  if (castM) {
    rest = castM[1];
    cast = castM[2];
  }
  return { alias, name: rest, hint, inner, children, cast };
}

function selectList(table: string, base: string, select: string, ctx: Ctx, innerWheres: string[]): string {
  const cols: string[] = [];
  for (const raw of splitTop(select)) {
    const it = parseSelectItem(raw);
    if (it.children !== null) {
      const fkOut = ctx.fks.filter((f) => f.table === table && f.ftable === it.name);
      const fkIn = ctx.fks.filter((f) => f.table === it.name && f.ftable === table);
      const pick = (list: ForeignKey[]): ForeignKey | undefined =>
        (it.hint ? list.find((f) => f.cols.includes(it.hint as string)) : undefined) ?? list[0];
      const out = pick(fkOut);
      const inn = pick(fkIn);
      const rel = `r${++ctx.n}`;
      const label = q(it.alias ?? it.name);
      if (out && !(inn && it.hint && inn.cols.includes(it.hint))) {
        const on = out.cols.map((c, i) => `${rel}.${q(out.fcols[i])} = ${base}.${q(c)}`).join(" and ");
        const sub = `select ${selectList(it.name, rel, it.children, ctx, [])} from ${q(it.name)} ${rel} where ${on} limit 1`;
        cols.push(`(select row_to_json(x${rel}) from (${sub}) x${rel}) as ${label}`);
        if (it.inner) innerWheres.push(`exists (select 1 from ${q(it.name)} ${rel}e where ${on.replace(new RegExp(`\\b${rel}\\.`, "g"), `${rel}e.`)})`);
      } else if (inn) {
        const on = inn.cols.map((c, i) => `${rel}.${q(c)} = ${base}.${q(inn.fcols[i])}`).join(" and ");
        const sub = `select ${selectList(it.name, rel, it.children, ctx, [])} from ${q(it.name)} ${rel} where ${on}`;
        cols.push(`(select coalesce(json_agg(x${rel}), '[]'::json) from (${sub}) x${rel}) as ${label}`);
        if (it.inner) innerWheres.push(`exists (select 1 from ${q(it.name)} ${rel}e where ${on.replace(new RegExp(`\\b${rel}\\.`, "g"), `${rel}e.`)})`);
      } else {
        throw new Error(`postgrestSql: no foreign key between ${table} and ${it.name}`);
      }
      continue;
    }
    if (it.name === "*") {
      cols.push(`${base}.*`);
      continue;
    }
    const { expr, name } = columnExpr(base, it.name);
    const withCast = it.cast ? `(${expr})::${it.cast}` : expr;
    cols.push(`${withCast} as ${q(it.alias ?? name)}`);
  }
  return cols.join(", ");
}

export interface BuiltQuery {
  sql: string;
  countSql: string;
  /** `single()` (object+json accept) semantics: exactly one row, else 406. */
  singleObject: boolean;
}

export function buildSelectSql(
  table: string,
  params: URLSearchParams,
  headers: { accept?: string | null; range?: string | null },
  fks: ForeignKey[],
): BuiltQuery {
  const ctx: Ctx = { fks, n: 0 };
  const base = "b";
  const wheres: string[] = [];
  let select = "*";
  let order = "";
  let limit: number | null = null;
  let offset = 0;
  for (const [k, v] of params.entries()) {
    if (k === "select") select = v;
    else if (k === "order") {
      order = splitTop(v)
        .map((o) => {
          const segs = o.split(".");
          const col = segs[0];
          const dir = segs.includes("desc") ? "desc" : "asc";
          const nulls = segs.includes("nullsfirst") ? " nulls first" : segs.includes("nullslast") ? " nulls last" : "";
          return `${columnExpr(base, col).expr} ${dir}${nulls}`;
        })
        .join(", ");
    } else if (k === "limit") limit = Number(v);
    else if (k === "offset") offset = Number(v);
    else if (k === "or" || k === "and") wheres.push(logicSql(base, k, v));
    else if (k === "not.or" || k === "not.and") wheres.push(`not ${logicSql(base, k.slice(4) as "or" | "and", v)}`);
    else if (k === "columns" || k === "on_conflict") continue;
    else wheres.push(filterSql(base, k, v));
  }
  if (headers.range) {
    const m = /^(\d+)-(\d*)$/.exec(headers.range);
    if (m) {
      offset = Number(m[1]);
      if (m[2] !== "") limit = Number(m[2]) - Number(m[1]) + 1;
    }
  }
  const cols = selectList(table, base, select, ctx, wheres);
  const whereSql = wheres.length ? ` where ${wheres.join(" and ")}` : "";
  const orderSql = order ? ` order by ${order}` : "";
  const limitSql = limit !== null ? ` limit ${limit}` : "";
  const offsetSql = offset ? ` offset ${offset}` : "";
  const inner = `select ${cols} from ${q(table)} ${base}${whereSql}${orderSql}${limitSql}${offsetSql}`;
  return {
    sql: `select coalesce(json_agg(t), '[]'::json) as j from (${inner}) t;`,
    countSql: `select count(*)::int as j from ${q(table)} ${base}${whereSql};`,
    singleObject: (headers.accept ?? "").includes("vnd.pgrst.object"),
  };
}
