import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Node16 ESM usa imports com extensão .js apontando para arquivos .ts.
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Vários testes de integração sobem um servidor HTTP próprio; rodar os
    // arquivos em série evita contenção de porta/recurso (determinístico).
    fileParallelism: false,
    testTimeout: 20000,
  },
});
