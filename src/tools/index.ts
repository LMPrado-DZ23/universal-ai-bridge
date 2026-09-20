import { mkdirSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./helpers.js";
import { registerFileTools } from "./files.js";
import { registerSearchTools } from "./search.js";
import { registerMediaTools } from "./media.js";
import { registerWatchTools } from "./watch.js";
import { registerPolicyTools } from "./policy.js";
import { registerShellTools } from "./shell.js";
import { registerEnvTools } from "./env.js";
import { registerJobTools } from "./jobs.js";
import { registerProcessTools } from "./process.js";
import { registerDockerTools } from "./docker.js";
import { registerNetTools } from "./net.js";

export type { Ctx } from "./helpers.js";

export function registerTools(server: McpServer, ctx: Ctx): void {
  mkdirSync(ctx.config.workspace, { recursive: true });
  // Sempre disponíveis (leitura/arquivos).
  registerFileTools(server, ctx);
  registerSearchTools(server, ctx);
  registerMediaTools(server, ctx);
  registerWatchTools(server, ctx);
  registerPolicyTools(server, ctx);
  // Domínio de terminal (gated por allowShell).
  registerShellTools(server, ctx);
  registerEnvTools(server, ctx);
  registerJobTools(server, ctx);
  registerProcessTools(server, ctx);
  // Modo admin.
  registerDockerTools(server, ctx);
  registerNetTools(server, ctx);
}
