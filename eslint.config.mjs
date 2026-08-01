/**
 * ESLint 9 flat config with Next.js + TypeScript (via FlatCompat).
 *
 * Some rules are relaxed below so `npm run lint` reflects real breakage: the repo
 * predates strict `<Link>` enforcement and uses `any` in tests. Tighten rules
 * in a follow-up; do not add `|| true` in CI to hide lint.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      // Playwright's webServer (next dev -p 3099) builds into .next-e2e
      // when NEXT_E2E_BUILD=1 — same shape as .next, same lint exclusion.
      ".next-e2e/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      // Shopify CLI deploy bundles — minified extension JS regenerated
      // on every `shopify app deploy`. Already gitignored; lint
      // shouldn't trip on the bundle (this caused release:verify to
      // fail on no-this-alias errors in transpiled extension output).
      ".shopify/**",
      "extensions/**/dist/**",
      // Claude Design sync tooling — generated/vendored bundles (incl. a
      // full vendored `_vendor/react.js`) dropped locally by the design
      // sync workflow. Already gitignored; lint shouldn't trip on the
      // vendored bundle (same rationale as the Shopify deploy bundles
      // above — it tripped release:verify with react-internal/* rule and
      // rules-of-hooks errors from React's own source).
      "ds-bundle/**",
      ".ds-sync/**",
      ".design-sync/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".vercel/**",
      // Reference-only TSX; not part of the app build.
      "docs/figma-reference/**",
      // Cursor IDE planning artifacts (Figma TSX exports, plan markdown).
      // Tracked for reference but not production code.
      ".cursor/**",
      // Claude Code sibling worktrees — local-only, never present in CI.
      // Listed so local lint matches CI output.
      ".claude/**",
      // Node CLI scripts use CJS patterns; lint app + lib + tests only.
      "scripts/**",
      "next.config.js",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Prefer next/link in new code; existing pages use <a href> widely.
      "@next/next/no-html-link-for-pages": "off",
      // Default: relaxed (tests + scripts use `any` widely).
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Phase 1.3 — production code (app/** + lib/**) must declare types
  // explicitly. Any new `any` produces a warning. Tests, scripts, and
  // the Figma reference TSX keep the relaxed default above.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: [
      "app/**/__tests__/**",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "lib/**/__tests__/**",
      "lib/**/tests/**",
      "lib/**/*.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Production code may not import test fixtures. The one that motivated
  // this rule is `tests/helpers/caseStrengthGates.ts` (`NO_GATES`):
  // `calculateCaseStrength` takes its gates as a REQUIRED object so that
  // adding a gate breaks every call site at compile time, and an
  // all-nulls shorthand importable from production would restore exactly
  // the hole the object closed — the new gate would break the shared
  // constant and nothing else. Production sites write the object out.
  // See docs/plans/case-strength-gates-object.plan.md §2.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: [
      "app/**/__tests__/**",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "lib/**/__tests__/**",
      "lib/**/tests/**",
      "lib/**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/tests/*", "@/tests/**", "**/tests/helpers/*", "**/tests/fixtures/*"],
              message:
                "Test fixtures are test-only. In particular NO_GATES: production callers of calculateCaseStrength must write the gates object literally, so a new gate breaks them at compile time.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
