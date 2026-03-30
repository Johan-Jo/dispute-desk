import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Next.js server modules use `server-only`; Vitest cannot resolve the package like Node.
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    globals: false,
    include: ["tests/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
  },
});
