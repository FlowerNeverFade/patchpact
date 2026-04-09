import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@patchpact/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@patchpact/adapters": resolve(__dirname, "packages/adapters/src/index.ts"),
    },
  },
});
