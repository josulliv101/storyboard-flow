import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["components/timeline/**/*.test.ts"],
  },
});
