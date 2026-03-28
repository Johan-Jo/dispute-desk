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
      "node_modules/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".vercel/**",
      // Reference-only TSX; not part of the app build.
      "docs/figma-reference/**",
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
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
