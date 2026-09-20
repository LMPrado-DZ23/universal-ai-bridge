import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
import { existsSync, realpathSync } from "node:fs";

/** true se `child` está dentro de (ou é) `base`. Ambos já resolvidos. */
function isInside(base: string, child: string): boolean {
  if (child === base) return true;
  const rel = relative(base, child);
  return rel !== "" && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel);
}

/** realpath tolerante (usa .native quando disponível). */
function realpath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return realpathSync(p);
  }
}

/** Caminho do ancestral existente mais próximo (sem resolver symlink). */
function nearestExisting(p: string): string {
  let cur = p;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

/**
 * Jaula de workspace. Resolve `input` e garante que fica DENTRO de `workspace`
 * lexicalmente E pelo caminho REAL (segue symlinks dos componentes que já
 * existem dentro do workspace). Bloqueia `../`, absolutos externos e symlinks
 * que apontem para fora.
 *
 * Nota: há uma pequena janela TOCTOU (o alvo pode virar symlink entre a
 * checagem e o uso). Para isolamento forte, rode em usuário/VM dedicados.
 */
export function safeResolve(workspace: string, input: string): string {
  const base = resolve(workspace);
  const target = isAbsolute(input) ? resolve(input) : resolve(base, input);

  // 1) Checagem lexical.
  if (!isInside(base, target)) {
    throw new Error(
      `Caminho fora do workspace bloqueado: "${input}". Tudo deve ficar dentro de ${base}`
    );
  }

  // 2) Checagem por caminho real, só quando há algo existente DENTRO do
  //    workspace (é onde um symlink poderia escapar). Se o workspace (ou o
  //    subcaminho) ainda não existe, não há symlink a seguir.
  if (existsSync(base)) {
    const realBase = realpath(base);
    const anc = nearestExisting(target);
    if (anc === target || isInside(base, anc)) {
      const realAnc = realpath(anc);
      if (!isInside(realBase, realAnc)) {
        throw new Error(
          `Symlink/caminho real escapando do workspace bloqueado: "${input}".`
        );
      }
    }
  }

  return target;
}

/** Caminho relativo bonito para exibir/logar sem vazar a raiz absoluta. */
export function display(workspace: string, absolutePath: string): string {
  const rel = relative(resolve(workspace), absolutePath);
  return rel === "" ? "." : rel.split(sep).join("/");
}
