import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "../config.js";
import { buildServer } from "../server.js";

/**
 * Transporte stdio: para clientes MCP locais (Claude Desktop, Cursor,
 * Gemini CLI). Sem rede, sem token — a confiança é o processo local.
 */
export async function startStdio(config: Config): Promise<void> {
  if(config.approval === "human_local") throw new Error("human_local exige transporte HTTP e painel administrativo local.");
  const { server, resources } = buildServer(config);
  const transport = new StdioServerTransport();
  server.server.onclose = () => resources.dispose();
  await server.connect(transport);
  // Nada de console.log aqui: stdout é o canal do protocolo.
  process.stderr.write(`[universal-ai-bridge] stdio pronto. workspace=${config.workspace}\n`);
}
