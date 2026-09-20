import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { Config } from "../config.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extrai o token de Authorization: Bearer <t> ou header X-Bridge-Token. */
export function extractToken(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = req.header("x-bridge-token");
  return x?.trim();
}

/** Valida token constante-tempo. Sem token configurado => sempre nega. */
export function checkToken(req: Request, config: Config): boolean {
  if (!config.token) return false;
  const provided = extractToken(req);
  if (!provided) return false;
  return safeEqual(provided, config.token);
}

/**
 * Defesa contra DNS rebinding: se houver header Origin, ele PRECISA estar
 * na allowlist. Requisições sem Origin (clientes não-browser) passam pelo
 * token. Requisições de browser sempre mandam Origin.
 */
export function checkOrigin(req: Request, config: Config): boolean {
  const origin = req.header("origin");
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}
