import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { safeResolve } from "../security/paths.js";
import { ok, fail, type Ctx } from "./helpers.js";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/** Leitura de mídia/binário (read-only): sempre disponível. */
export function registerMediaTools(server: McpServer, ctx: Ctx): void {
  const ws = ctx.config.workspace;

  server.registerTool(
    "read_media_file",
    {
      title: "Ler imagem/binário",
      description:
        "Lê um arquivo de imagem (retorna como imagem) ou outro binário (retorna base64). Respeita o limite de tamanho.",
      inputSchema: { path: z.string().describe("Caminho relativo ao workspace") },
    },
    async ({ path }) => {
      try {
        const abs = safeResolve(ws, path);
        const st = statSync(abs);
        const max = ctx.config.policy.files.maxReadBytes;
        if (st.size > max) return fail(`Arquivo muito grande (${st.size} > limite ${max} bytes).`);
        const buf = readFileSync(abs);
        const ext = extname(abs).toLowerCase();
        ctx.audit.record({ tool: "read_media_file", decision: "allow", args: { path } });

        const mime = IMAGE_MIME[ext];
        if (mime && ext !== ".svg") {
          return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: mime }] };
        }
        return ok(
          JSON.stringify({
            path,
            bytes: st.size,
            mimeType: mime ?? "application/octet-stream",
            base64: buf.toString("base64"),
          })
        );
      } catch (e) {
        return fail(String((e as Error).message));
      }
    }
  );
}
