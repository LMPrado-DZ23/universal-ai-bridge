import { resolve, relative, isAbsolute, sep } from "node:path";

/**
 * Jaula de workspace. Resolve `input` (relativo ao workspace, ou absoluto)
 * e garante que o resultado permanece DENTRO de `workspace`.
 * Lança erro em qualquer tentativa de escapar (../, symlink-ish, drive troca).
 */
export function safeResolve(workspace: string, input: string): string {
  const base = resolve(workspace);
  const target = isAbsolute(input) ? resolve(input) : resolve(base, input);

  const rel = relative(base, target);
  const escapes = rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `Caminho fora do workspace bloqueado: "${input}". Tudo deve ficar dentro de ${base}`
    );
  }
  return target;
}

/** Caminho relativo bonito para exibir/logar sem vazar a raiz absoluta. */
export function display(workspace: string, absolutePath: string): string {
  const rel = relative(resolve(workspace), absolutePath);
  return rel === "" ? "." : rel.split(sep).join("/");
}
