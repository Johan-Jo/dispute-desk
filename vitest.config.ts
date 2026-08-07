import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Component tests render real JSX; the automatic runtime keeps them free of
  // a `React` import the app itself does not use.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Next.js server modules use `server-only`; Vitest cannot resolve the package like Node.
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    globals: false,
    include: [
      // `.tsx` is included so a component can be RENDERED in a test. PR-C1's
      // review-required banner regressed behind a green pure-helper test: the
      // helper returned `showReviewRequired`, the component never read it, and
      // nothing in the suite could tell. Placement needs a real render.
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "lib/**/__tests__/**/*.test.ts",
      "lib/**/tests/**/*.test.ts",
      "app/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.tsx",
    ],
  },
});
