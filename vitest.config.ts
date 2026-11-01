import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // React components are rendered in a few tests (labels); use the automatic JSX runtime like Next.js.
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
