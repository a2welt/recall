import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 60_000, // embedding model load can be slow on first run
    include: ["tests/**/*.test.ts"],
  },
});
