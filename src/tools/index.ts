import { mkdirSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./helpers.js";
import { registerFileTools } from "./files.js";
import { registerSearchTools } from "./search.js";
import { registerShellTools } from "./shell.js";
import { registerJobTools } from "./jobs.js";
import { registerProcessTools } from "./process.js";
import { registerDockerTools } from "./docker.js";

export type { Ctx } from "./helpers.js";

export function registerTools(server: McpServer, ctx: Ctx): void {
  mkdirSync(ctx.config.workspace, { recursive: true });
  registerFileTools(server, ctx);
  registerSearchTools(server, ctx);
  registerShellTools(server, ctx);
  registerJobTools(server, ctx);
  registerProcessTools(server, ctx);
  registerDockerTools(server, ctx);
}
