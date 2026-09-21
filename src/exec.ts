import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { statSync } from "node:fs";
import { join, isAbsolute, extname } from "node:path";
import { scanShellUnsafe } from "./policy/engine.js";

const IS_WIN = process.platform === "win32";
const COMSPEC = process.env.ComSpec || "cmd.exe";

/** Resolve um executável no PATH (+PATHEXT no Windows). null se não achar. */
export function resolveExecutable(program: string): string | null {
  const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
  const supported = /\.(exe|com|cmd|bat)$/i;
  if (isAbsolute(program)) return (!IS_WIN || supported.test(program)) && isFile(program) ? program : null;
  // npm ships both an extensionless POSIX script and npm.cmd. Never select
  // the POSIX shim on Windows; CreateProcess cannot execute it (ENOEXEC).
  const exts = IS_WIN ? (supported.test(program) ? [""] :
    (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(e => supported.test(e))) : [""];
  for (const dir of (process.env.PATH ?? "").split(IS_WIN ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      for (const cand of [join(dir, program + ext), join(dir, program + ext.toLowerCase())]) {
        if (isFile(cand)) return cand;
      }
    }
  }
  return null;
}

function isBatch(p: string): boolean {
  const e = extname(p).toLowerCase();
  return e === ".cmd" || e === ".bat";
}

/** Tokeniza uma linha respeitando aspas simples/duplas. */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/**
 * Converte o campo legado `command: string` em {program, args} de forma
 * RESTRITA: rejeita sintaxe ambígua/perigosa (via scanShellUnsafe) antes de
 * tokenizar. Nunca alimenta um shell.
 */
export function parseCommand(command: string): { program: string; args: string[] } {
  const unsafe = scanShellUnsafe(command);
  if (unsafe) throw new Error(`Comando rejeitado (use program+args): ${unsafe}`);
  const toks = tokenize(command);
  if (toks.length === 0) throw new Error("Comando vazio.");
  return { program: toks[0], args: toks.slice(1) };
}

/** Args seguros para batch via cmd.exe (sem aspas/%/controle). */
function assertBatchArgsSafe(args: string[]): void {
  for (const a of args) {
    if (/["%&|<>^!();\x00-\x1f\x7f]/.test(a) || a.endsWith("\\")) {
      throw new Error("Argumento inseguro para script .cmd/.bat (aspas, %, ou controle).");
    }
  }
}

export interface SpawnPlan {
  file: string;
  spawnArgs: string[];
  verbatim: boolean;
}

/** Batch requires cmd.exe on Windows. Native executables never use it.
 * No free-form command: fixed switches, quoted validated batch path and args.
 * Batch may reparse %* (e.g. CALL), so reject metacharacters rather than
 * assuming quotes survive every script. Use a native executable for such args.
 */
export function batchPlan(resolved: string, args: string[]): SpawnPlan {
  if (/["%\x00-\x1f\x7f]/.test(resolved)) throw new Error("Caminho batch inseguro.");
  assertBatchArgsSafe(args);
  const inner = [resolved, ...args].map(s => `"${s}"`).join(" ");
  return { file: COMSPEC, spawnArgs: ["/d", "/v:off", "/s", "/c", `"${inner}"`], verbatim: true };
}

function plan(program: string, args: string[]): SpawnPlan {
  const resolved = resolveExecutable(program);
  if (!resolved) throw Object.assign(new Error("Executável não encontrado no PATH."), { code: "ENOENT" });
  if (IS_WIN && isBatch(resolved)) return batchPlan(resolved, args);
  return { file: resolved, spawnArgs: args, verbatim: false };
}

export interface RunOpts {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
}

/** Execução SÍNCRONA sem shell. */
export function runStructuredSync(program: string, args: string[], opts: RunOpts): SpawnSyncReturns<string> {
  const p = plan(program, args);
  return spawnSync(p.file, p.spawnArgs, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    timeout: opts.timeout,
    maxBuffer: opts.maxBuffer,
    windowsHide: true,
    encoding: "utf8",
    shell: false,
    windowsVerbatimArguments: p.verbatim,
  });
}

/** Execução ASSÍNCRONA sem shell (para jobs longos). */
export function spawnStructured(program: string, args: string[], opts: RunOpts): ChildProcess {
  const p = plan(program, args);
  return spawn(p.file, p.spawnArgs, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    detached: !IS_WIN, // POSIX: grupo próprio p/ matar a árvore
    windowsHide: true,
    shell: false,
    windowsVerbatimArguments: p.verbatim,
  });
}
