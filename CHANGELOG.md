# Changelog

## 0.4.1 — Rodada de segurança (resposta à auditoria)

Correção dos bloqueadores reproduzíveis apontados na auditoria técnica.

### Segurança (corrigido)
- **C1 — bypass de shell por `&`/newline:** `PolicyEngine.checkCommand` agora usa
  um scanner **ciente de aspas** (`scanShellUnsafe`) que rejeita, fora de aspas,
  os operadores `; | & < > ( )` e, fora de aspas simples, `$` e crase, além de
  qualquer caractere de controle (newline, CR, tab, NUL). Conteúdo legítimo entre
  aspas (ex.: `node -e "console.log(1>0)"`) continua permitido. Fecha o
  encadeamento reproduzido no endpoint MCP real.
- **C2 — SSRF por redirect em `download_to_file`:** agora segue redirects
  **manualmente** (`redirect: "manual"`), revalida o host a cada salto resolvendo
  todos os A/AAAA, bloqueia loopback/RFC1918/link-local/CGNAT/multicast/IPv6
  privado/`::ffff:` mapeado/`0.0.0.0`, impõe timeout (`AbortController`), teto de
  redirects e teto de bytes durante o streaming, e aplica a política de extensão.
- **C3 — symlink em busca:** `search_files`/`search_content` não seguem symlinks
  (checagem `lstat` + `isSymbolicLink` no walk e revalidação por `safeResolve`
  antes de ler).
- **C7 — `kill_process`:** por padrão só encerra processos iniciados pelo bridge;
  PID externo exige modo admin + `allow_external: true` + aprovação.
- **C8 — `set_env`:** bloqueia variáveis de carregamento/estruturais
  (`PATH`, `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `DYLD_*`, `PYTHONPATH`, `PYTHONSTARTUP`, e segredos do bridge).
- **C9 (parcial):** argumentos do `docker` passam pelo mesmo scanner ciente de aspas.
- **C13 — configuração fail-closed:** `BRIDGE_PORT` (1–65535), `BRIDGE_MODE`,
  `BRIDGE_APPROVAL` e token são validados no carregamento; token placeholder ou
  com menos de 16 chars é rejeitado; `admin` sem `BRIDGE_ADMIN_ACK` não sobe.
- **C14 — BOM:** `setup.ps1` grava `.env` em UTF-8 **sem BOM**.

### Higiene (C18)
- Removidos os arquivos vazios acidentais: `Apps`, `audit/n-`, `t.name)`,
  `this.view(id))`, `{,`, `{,+`, `{}`, `healthcheck`.
- `src/tools/search.ts` reescrito como UTF-8 limpo (sem byte NUL; `file` agora o
  reconhece como texto).

### Consistência (C17)
- Versão unificada em `package.json`, `src/server.ts` e no Inno Setup (`0.4.1`).

### Testes
- 71 testes (15 novos de regressão): `&`/newline no endpoint MCP, `isPrivateIp`
  (IPv4/IPv6/mapeado/CGNAT), validação de configuração, `kill_process` externo,
  `set_env` perigoso, symlink em `search_content`.

### Pendências honestas (não corrigidas nesta rodada)
- **DevDependencies:** `vitest`/`vite`/`esbuild` têm advisories **somente de
  desenvolvimento** (`npm audit --omit=dev` = 0). A correção exige um salto maior
  de major do Vitest que o resolvedor de peers recusou (ERESOLVE); não afeta o
  runtime de produção nem usamos o mocker vulnerável.
- **Camada de sessão remota** (device pairing, rotação/revogação de token, rate
  limit, ownership de jobs por sessão) — Fase 2, não implementada.
- **Formatos de documento** (PDF/DOCX/XLSX), **PTY real**, **paginação de terminal**
  e **execução em memória** — Fase 4, não implementadas.
- **Instalador:** verificação de checksum/assinatura dos downloads (Node/cloudflared),
  SBOM e CI multi-OS — Fase 5, não implementadas.
- **Isolamento real** continua exigindo usuário dedicado/VM/Docker rootless no modo
  admin; o produto é guardrail, não sandbox (documentado).
