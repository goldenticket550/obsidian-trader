import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  // Automatic JSX runtime so component tests (.tsx) don't need React in scope.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Node by default (keeps the fast pure-logic suite unchanged); component
    // tests opt into a DOM via a per-file `// @vitest-environment happy-dom`.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
