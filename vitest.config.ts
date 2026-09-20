import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Node16 ESM usa imports com extensão .js apontando para arquivos .ts.
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
