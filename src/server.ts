import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { PolicyEngine } from "./policy/engine.js";
import { ConfirmStore } from "./confirm.js";
import { Audit } from "./audit/log.js";
import { registerTools } from "./tools.js";

/** Fábrica: monta um McpServer novo com todas as tools registradas. */
export function buildServer(config: Config): McpServer {
  const server = new McpServer({
    name: "universal-ai-bridge",
    version: "0.1.0",
  });

  registerTools(server, {
    config,
    policy: new PolicyEngine(config.policy),
    confirm: new ConfirmStore(),
    audit: new Audit(config.auditDir),
  });

  return server;
}
