import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.spec.ts"],
    // Several files (prepare-session, sync-session, view-session) reset
    // shared InventorySession/InventoryLine/AuditLog tables against one real
    // Postgres instance via unscoped deleteMany({}) in beforeEach/afterAll.
    // Running files in parallel races those resets against each other
    // (FK violations); this suite is small enough that serializing files is
    // cheap and removes the flakiness at the source.
    fileParallelism: false,
  },
});
