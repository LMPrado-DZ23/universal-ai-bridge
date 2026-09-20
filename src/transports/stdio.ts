import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "../config.js";
import { buildServer } from "../server.js";

/**
 * Transporte stdio: para clientes MCP locais (Claude Desktop, Cursor,
 * Gemini CLI). Sem rede, sem token — a confiança é o processo local.
 */
export async function startStdio(config: Config): Promise<void> {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Nada de console.log aqui: stdout é o canal do protocolo.
  process.stderr.write(`[universal-ai-bridge] stdio pronto. workspace=${config.workspace}\n`);
}
