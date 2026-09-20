import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { buildServer } from "../server.js";
import { checkToken, checkOrigin } from "../security/auth.js";

/**
 * Transporte Streamable HTTP: para IAs no navegador (ChatGPT, Claude.ai)
 * via túnel HTTPS. Protegido por token Bearer + checagem de Origin.
 * O endpoint MCP é POST/GET/DELETE em /mcp.
 */
export async function startHttp(config: Config): Promise<void> {
  if (!config.token) {
    process.stderr.write(
      "[universal-ai-bridge] ERRO: BRIDGE_TOKEN não definido. O transporte HTTP recusa subir sem token.\n"
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json({ limit: "8mb" }));

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Middleware de segurança para todo /mcp.
  app.use("/mcp", (req: Request, res: Response, next) => {
    if (!checkOrigin(req, config)) {
      res.status(403).json({ error: "Origin não permitido" });
      return;
    }
    if (!checkToken(req, config)) {
      res.status(401).json({ error: "Token ausente ou inválido" });
      return;
    }
    next();
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
        enableDnsRebindingProtection: true,
        allowedOrigins: config.allowedOrigins,
      });
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };
      const server = buildServer(config);
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Sessão inválida: falta initialize." },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Sessão inválida ou ausente");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  app.get("/mcp", sessionRequest);
  app.delete("/mcp", sessionRequest);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, workspace: config.workspace });
  });

  // Escuta SOMENTE em loopback: o túnel (cloudflared) faz a ponte externa.
  app.listen(config.port, "127.0.0.1", () => {
    process.stderr.write(
      `[universal-ai-bridge] HTTP pronto em http://127.0.0.1:${config.port}/mcp (loopback). workspace=${config.workspace}\n`
    );
  });
}
