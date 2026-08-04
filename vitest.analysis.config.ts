/**
 * Analysis runner — NOT part of CI.
 *
 * `vitest.config.ts` collects `tests/**` and `lib/**\/__tests__/**`, so nothing
 * here is ever picked up by `npm test`. These files read PRODUCTION data
 * read-only to produce migration evidence (transition matrices,
 * threshold-crossing counts) that the plan requires before a phase ships.
 *
 * Keeping them in a separate config is the structural guarantee that a prod-
 * reading job can never become a CI dependency, and that CI can never be
 * turned red by an environment it has no credentials for.
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/<file>.analysis.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    globals: false,
    include: ["scripts/**/*.analysis.ts"],
    // A prod read over hundreds of packs is slower than a unit test.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
