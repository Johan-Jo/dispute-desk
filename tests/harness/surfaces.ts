/**
 * Surface enumeration and execution proof (single-source plan 3.3).
 *
 * A SURFACE is a `.ts`/`.tsx` file under `app/**` or `components/**` that
 * imports the workspace payload type (`WorkspaceData`), the workspace hook, or
 * `lib/disputes/presentation`, and exports at least one function or component.
 * Every surface must either be REACHED - an exported function of the file ran
 * while the render harness / pure builders processed the fixtures, measured by
 * V8 precise function coverage, not by the import graph - or carry a baselined
 * exemption with a reason.
 */
import fs from "node:fs";
import inspector from "node:inspector";
import path from "node:path";
import ts from "typescript";

const SURFACE_ROOTS = ["app", "components"] as const;
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "messages"]);

export interface Surface {
  /** Repo-relative, forward slashes. */
  file: string;
  /** Names of exported functions/components (what coverage must show running). */
  exportedFunctions: string[];
}

const PAYLOAD_NAMES = new Set(["WorkspaceData", "Workspace"]);

function importsPayload(sf: ts.SourceFile): boolean {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (/(^|\/)useDisputeWorkspace$/.test(spec)) return true;
    if (/^@\/lib\/disputes\/presentation(\/|$)/.test(spec)) return true;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.some((e) => PAYLOAD_NAMES.has((e.propertyName ?? e.name).text))) {
      return true;
    }
  }
  return false;
}

function exportedFunctionNames(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const isExported = (n: ts.Node) =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st) && st.name) out.push(st.name.text);
    else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          out.push(d.name.text);
        }
      }
    }
  }
  return out;
}

function walk(dir: string, acc: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), acc);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.[tj]sx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      acc.push(path.join(dir, e.name));
    }
  }
}

export function enumerateSurfaces(repoRoot: string): Surface[] {
  const files: string[] = [];
  for (const r of SURFACE_ROOTS) walk(path.join(repoRoot, r), files);
  const out: Surface[] = [];
  for (const f of files.sort()) {
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (!importsPayload(sf)) continue;
    const fns = exportedFunctionNames(sf);
    // Default exports (`export default function Page`) are functions too.
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        if (!fns.includes(st.name.text)) fns.push(st.name.text);
      }
    }
    if (fns.length === 0) continue; // type-only module: nothing to execute
    out.push({ file: path.relative(repoRoot, f).split(path.sep).join("/"), exportedFunctions: fns });
  }
  return out;
}

/* ── V8 precise function coverage, in-process ── */

export interface CoverageRun {
  stop(): Map<string, Set<string>>;
}

/** Start counting function calls; `stop()` returns, per script path, the names of functions that ran. */
export function startFunctionCoverage(repoRoot: string): CoverageRun {
  const session = new inspector.Session();
  session.connect();
  const post = <T,>(method: string, params?: object): T => {
    let result: T | undefined;
    session.post(method, params ?? {}, (err, res) => {
      if (err) throw err;
      result = res as T;
    });
    return result as T;
  };
  post("Profiler.enable");
  post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  return {
    stop() {
      const res = post<{ result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }> }>(
        "Profiler.takePreciseCoverage",
      );
      post("Profiler.stopPreciseCoverage");
      post("Profiler.disable");
      session.disconnect();
      const root = repoRoot.split(path.sep).join("/").toLowerCase();
      const ran = new Map<string, Set<string>>();
      for (const script of res?.result ?? []) {
        let p = script.url;
        if (p.startsWith("file://")) p = decodeURIComponent(p.replace(/^file:\/\/\/?/, ""));
        p = p.split("\\").join("/");
        const lower = p.toLowerCase();
        const at = lower.indexOf(root);
        if (at === -1) continue;
        const rel = p.slice(at + root.length).replace(/^\//, "");
        const names = ran.get(rel) ?? new Set<string>();
        for (const fn of script.functions) {
          if (fn.functionName && (fn.ranges[0]?.count ?? 0) > 0) names.add(fn.functionName);
        }
        ran.set(rel, names);
      }
      return ran;
    },
  };
}

/** Surfaces whose exported function ran. */
export function reachedSurfaces(surfaces: Surface[], ran: Map<string, Set<string>>): Set<string> {
  const reached = new Set<string>();
  for (const s of surfaces) {
    const names = ran.get(s.file);
    if (names && s.exportedFunctions.some((n) => names.has(n))) reached.add(s.file);
  }
  return reached;
}
