import { parseEnv } from "node:util";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

export type ApprovalMode = "auto" | "confirm" | "local" | "human_local";
export type BridgeMode = "safe" | "admin";

/** Frase exata exigida para habilitar o modo administrador (anti-acidente). */
export const ADMIN_ACK_PHRASE = "I_UNDERSTAND_FULL_PC_ACCESS";

export interface PolicyFile {
  shell: {
    allow: string[];
    deny: string[];
    denyPatterns: string[];
    maxOutputBytes: number;
    timeoutMs: number;
  };
  files: {
    deniedExtensions: string[];
    maxWriteBytes: number;
    maxReadBytes: number;
    listMaxEntries: number;
  };
}

export interface Config {
  adminSecret?: string;
  transport?: "stdio" | "http";
  mode: BridgeMode;
  workspace: string;
  token: string | undefined;
  port: number;
  adminPort: number;
  maxSessions: number;
  allowedOrigins: string[];
  allowedHosts: string[];
  approval: ApprovalMode;
  allowShell: boolean;
  allowDocker: boolean;
  policy: PolicyFile;
  auditDir: string;
  dataDir: string;
  envFile: string;
  limits?: ResourceLimits;
  auditRequired?: boolean;
}

/** Carrega variáveis de um arquivo .env para process.env. Silencioso se ausente. */
export function applyEnvFile(path: string): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false; // sem .env: usa o process.env já existente
  }
}

const PLACEHOLDER_TOKENS = new Set([
  "troque-por-um-token-aleatorio-forte",
  "changeme",
  "token",
]);

function parseApproval(v: string | undefined): ApprovalMode {
  if (v === undefined || v === "") return "confirm";
  if (v === "auto" || v === "confirm" || v === "local" || v === "human_local") return v;
  throw new Error(`BRIDGE_APPROVAL inválido: "${v}". Use auto, confirm, local ou human_local.`);
}

function parsePort(v: string | undefined): number {
  const n = Number(v ?? 8787);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`BRIDGE_PORT inválido: "${v}". Use um inteiro entre 1 e 65535.`);
  }
  return n;
}

/** Valida o token (quando presente). HTTP sem token é recusado no transporte. */
function validateToken(token: string | undefined): void {
  if (token === undefined || token === "") return;
  if (PLACEHOLDER_TOKENS.has(token.toLowerCase()) || !/^([a-fA-F0-9]{64}|[A-Za-z0-9_-]{43})$/.test(token)) {
    throw new Error(
      "BRIDGE_TOKEN fraco ou placeholder. Gere um token forte (32 bytes: 64 hex ou 43 base64url chars): " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
}

function loadPolicy(): PolicyFile {
  const raw = readFileSync(resolve(projectRoot, "config", "policy.json"), "utf8");
  return policySchema.parse(JSON.parse(raw));
}

/**
 * Resolve as flags de modo. Modo admin é opt-in DELIBERADO: exige
 * BRIDGE_MODE=admin **e** o reconhecimento explícito em BRIDGE_ADMIN_ACK.
 * Sem o reconhecimento, cai em safe (nunca liga admin por acidente).
 */
export function resolveMode(env: NodeJS.ProcessEnv = process.env): {
  mode: BridgeMode;
  allowShell: boolean;
  allowDocker: boolean;
} {
  if (env.BRIDGE_MODE !== undefined && env.BRIDGE_MODE !== "" && env.BRIDGE_MODE !== "safe" && env.BRIDGE_MODE !== "admin") {
    throw new Error(`BRIDGE_MODE inválido: "${env.BRIDGE_MODE}". Use safe ou admin.`);
  }
  strictBoolean(env.BRIDGE_ALLOW_SHELL, "BRIDGE_ALLOW_SHELL");
  strictBoolean(env.BRIDGE_ALLOW_DOCKER, "BRIDGE_ALLOW_DOCKER");
  const wantsAdmin = env.BRIDGE_MODE === "admin";
  const acked = env.BRIDGE_ADMIN_ACK === ADMIN_ACK_PHRASE;

  if (wantsAdmin && !acked) {
    throw new Error(
      `Modo admin pedido, mas sem reconhecimento. Defina BRIDGE_ADMIN_ACK="${ADMIN_ACK_PHRASE}" ` +
        `para confirmar que você entende que o processo terá acesso amplo ao computador.`
    );
  }

  const mode: BridgeMode = wantsAdmin && acked ? "admin" : "safe";

  if (mode === "safe") {
    return {
      mode,
      // Safe: shell só liga com valor explícito "true". Docker sempre bloqueado.
      allowShell: env.BRIDGE_ALLOW_SHELL === "true",
      allowDocker: false,
    };
  }

  // Admin: shell ligado por padrão; Docker só com flag explícita.
  return {
    mode,
    allowShell: env.BRIDGE_ALLOW_SHELL !== "false",
    allowDocker: env.BRIDGE_ALLOW_DOCKER === "true",
  };
}

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  // Explicit file replaces the project file, never silently falls back.
  // Inherited settings win, except a persisted token (including revocation ""):
  // restarting must not resurrect the old inherited credential.
  const selected = process.env.BRIDGE_ENV_FILE || resolve(projectRoot, ".env");
  let fileEnv: NodeJS.ProcessEnv = {};
  try { fileEnv = parseEnv(readFileSync(selected, "utf8")); }
  catch (error) {
    if (process.env.BRIDGE_ENV_FILE || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("BRIDGE_ENV_FILE não pôde ser carregado.");
  }
  const env: NodeJS.ProcessEnv = { ...fileEnv, ...process.env };
  if (Object.hasOwn(fileEnv, "BRIDGE_TOKEN")) env.BRIDGE_TOKEN = fileEnv.BRIDGE_TOKEN;

  const { mode, allowShell, allowDocker } = resolveMode(env);

  const workspace = env.BRIDGE_WORKSPACE
    ? resolve(env.BRIDGE_WORKSPACE)
    : resolve(projectRoot, "workspace");

  // Pasta de dados/auditoria: usa BRIDGE_DATA_DIR quando definido (instalação).
  const dataDir = env.BRIDGE_DATA_DIR ? resolve(env.BRIDGE_DATA_DIR) : projectRoot;
  const auditDir = resolve(dataDir, "audit");
  const envFile = resolve(selected);

  validateToken(env.BRIDGE_TOKEN);

  const port = parsePort(env.BRIDGE_PORT);
  // adminPort: validado APÓS derivar o default (port+1 pode estourar 65535).
  const adminPort = env.BRIDGE_ADMIN_PORT ? parsePort(env.BRIDGE_ADMIN_PORT) : port + 1;
  if (adminPort < 1 || adminPort > 65535) {
    throw new Error(
      `Porta admin inválida (${adminPort}). BRIDGE_PORT+1 estourou o limite — defina BRIDGE_ADMIN_PORT (1–65535).`
    );
  }
  if (adminPort === port) {
    throw new Error("BRIDGE_ADMIN_PORT não pode ser igual a BRIDGE_PORT.");
  }

  const maxSessions = Number(env.BRIDGE_MAX_SESSIONS ?? 20);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100) {
    throw new Error(`BRIDGE_MAX_SESSIONS inválido: "${env.BRIDGE_MAX_SESSIONS}".`);
  }

  return {
    mode,
    adminSecret: env.BRIDGE_ADMIN_SECRET,
    transport: env.BRIDGE_TRANSPORT === "http" ? "http" : "stdio",
    limits: loadLimits(env),
    auditRequired: strictBoolean(env.BRIDGE_AUDIT_REQUIRED, "BRIDGE_AUDIT_REQUIRED") ?? false,
    workspace,
    token: env.BRIDGE_TOKEN,
    port,
    adminPort,
    maxSessions,
    allowedOrigins: csv(env.BRIDGE_ALLOWED_ORIGINS),
    allowedHosts: csv(env.BRIDGE_ALLOWED_HOSTS),
    approval: parseApproval(env.BRIDGE_APPROVAL),
    allowShell,
    allowDocker,
    policy: loadPolicy(),
    auditDir,
    dataDir,
    envFile,
  };
}

export function strictBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name}: use somente true ou false.`);
}
const names = z.array(z.string().min(1).max(256)).max(256);
export const policySchema = z.object({
  $comment: z.string().max(2000).optional(),
  shell: z.object({ allow: names, deny: names, denyPatterns: names,
    maxOutputBytes: z.number().int().min(1024).max(4_000_000),
    timeoutMs: z.number().int().min(100).max(120_000),
  }).strict(),
  files: z.object({ deniedExtensions: names,
    maxWriteBytes: z.number().int().min(1).max(10_000_000),
    maxReadBytes: z.number().int().min(1).max(10_000_000),
    listMaxEntries: z.number().int().min(1).max(10_000),
  }).strict(),
}).strict();
export const DEFAULT_LIMITS = {
  activeJobs: 4, globalJobs: 32, retainedJobs: 32, ptys: 4, watchers: 8,
  confirmations: 64, stdinBytes: 65536, jobTtlMs: 300000,
  confirmationTtlMs: 300000, concurrentRequests: 4, outputBytes: 4_000_000,
};
export type ResourceLimits = typeof DEFAULT_LIMITS;
export function loadLimits(env: NodeJS.ProcessEnv): ResourceLimits {
  const result = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(result) as (keyof ResourceLimits)[]) {
    const name = 'BRIDGE_LIMIT_' + key.replace(/[A-Z]/g, c => '_' + c).toUpperCase();
    const raw = env[name];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > DEFAULT_LIMITS[key] * 4)
      throw new Error(`${name}: limite inválido (1..${DEFAULT_LIMITS[key] * 4}).`);
    result[key] = n;
  }
  return result;
}
