import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: [
      "app/**/*.test.ts",
      "components/**/*.test.ts",
      "lib/**/*.test.ts",
      "../../packages/ui/timeline/**/*.test.ts",
    ],
  },
});
