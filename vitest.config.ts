import { defineConfig } from "vitest/config";
import path from "path";

// Tests that write to the real database (CI's throwaway *_ci one) run one file at a time: two files clearing and
// filling the same users table at once would break each other. Everything else runs in parallel.
const DB_TESTS = [
  "__tests__/auth-roles.test.ts",
  "__tests__/payments-flow.test.ts",
  "__tests__/db-schema.test.ts",
  "__tests__/db-collation.test.ts",
  "__tests__/market-data-collector.test.ts",
  "__tests__/news-study.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["__tests__/**/*.test.ts"], exclude: DB_TESTS } },
      { extends: true, test: { name: "db", include: DB_TESTS, fileParallelism: false } },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
