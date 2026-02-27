import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["**/*.test.js", "**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/supabase/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["registry.js"],
      exclude: ["**/node_modules/**", "**/supabase/**", "**/*.test.js"],
    },
  },
});
