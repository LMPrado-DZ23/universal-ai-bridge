import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

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
  };
}

export interface Config {
  workspace: string;
  token: string | undefined;
  port: number;
  allowedOrigins: string[];
  approval: "auto" | "confirm";
  allowShell: boolean;
  policy: PolicyFile;
  auditDir: string;
}

function loadPolicy(): PolicyFile {
  const raw = readFileSync(resolve(projectRoot, "config", "policy.json"), "utf8");
  return JSON.parse(raw) as PolicyFile;
}

export function loadConfig(): Config {
  const workspace = process.env.BRIDGE_WORKSPACE
    ? resolve(process.env.BRIDGE_WORKSPACE)
    : resolve(projectRoot, "workspace");

  const allowedOrigins = (process.env.BRIDGE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    workspace,
    token: process.env.BRIDGE_TOKEN,
    port: Number(process.env.BRIDGE_PORT ?? 8787),
    allowedOrigins,
    approval: process.env.BRIDGE_APPROVAL === "auto" ? "auto" : "confirm",
    allowShell: process.env.BRIDGE_ALLOW_SHELL !== "false",
    policy: loadPolicy(),
    auditDir: resolve(projectRoot, "audit"),
  };
}
