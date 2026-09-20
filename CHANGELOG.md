# Changelog

## 0.6.1 — Correções da 2ª auditoria (ciclo de vida, audit, config, supply-chain)

- **C3 — cleanup por sessão:** cada sessão HTTP tem `SessionResources` com
  `dispose()` idempotente; jobs/PTYs/watchers/confirmações/env são encerrados e
  removidos dos registros estáticos em `onclose`, `DELETE /mcp`, timeout ocioso,
  `/admin/revoke`, `/admin/panic` e shutdown. (regressão e2e: job infinito morre
  ao fechar a sessão).
- **C4 — adminPort:** valida a porta admin **após** derivar o default; `BRIDGE_PORT=65535`
  agora falha claramente (ou exige `BRIDGE_ADMIN_PORT`).
- **C5 — audit sem segredos:** `run_command`/`run_job`/`docker`/`pty_start` gravam
  `{program, argc, len, sha}` (nunca o comando); `download_to_file` grava
  `{scheme, host, port, len, sha}` (sem query/fragmento); `sanitizeArgs` passa a
  hashear qualquer string. (regressão: `TOPSECRET_AUDIT_VALUE` não aparece no log).
- **C6 — rotação de token PERSISTENTE:** `TokenStore` grava o novo token no `.env`
  (escrita atômica temp+rename, 0600) quando o arquivo existe → sobrevive a
  reinícios; sem `.env`, fica em memória e `persists=false`.
- **C9 — cloudflared:** versão fixa por padrão (não `latest`), com fallback
  resiliente e verificação Authenticode do editor Cloudflare.
- **C10 — parada de emergência:** `stop-access.ps1` mata **apenas os PIDs
  registrados** do bridge (via `taskkill /T`), nunca cloudflared/node de terceiros.
- **C8 — versões unificadas:** `package-lock.json` sincronizado; teste de CI falha
  se package/lock/server/Inno/CHANGELOG divergirem.
- **Fase 6 — `get_workspace_info`** não revela o caminho absoluto por padrão
  (`include_absolute_path` opcional).
- 98 testes (novos: adminPort, persistência de token, cleanup de sessão e2e,
  audit-sem-segredo, consistência de versão). `npm audit --omit=dev` = 0.

### Pendências honestas (fases grandes, não concluídas nesta rodada)
- **Fase 2 completa** (executor `program`+`args[]` com `shell:false` no safe e
  resolução cross-platform de `.cmd`): o safe ainda usa `shell:true` com o scanner
  ciente de aspas como barreira; a migração para no-shell é o próximo passo maior.
- **Fase 8** (edição avançada de docs, preview rico, ripgrep, auto-update,
  device pairing na nuvem, CI multi-OS) — backlog.
- **`human_local`** (aprovação em GUI local sem revelar código): hoje há `local`
  (código no console local) e `confirm` (2 etapas lógicas).

## 0.6.0 — Escrita de documentos + pacote de re-auditoria

- **Criação de documentos** (efeito colateral, sujeito a política/aprovação):
  - `write_sheet` (exceljs) — cria `.xlsx` ou `.csv` a partir de linhas.
  - `write_docx` (docx) — cria `.docx` a partir de parágrafos.
  - `write_pdf` (pdfkit) — cria `.pdf` a partir de texto.
  Dependências novas de produção: `docx`, `pdfkit` (+ `@types/pdfkit` dev).
  `npm audit --omit=dev` permanece **0**.
- **Round-trip testado:** write→read para XLSX, DOCX e PDF (`docwrite.test.ts`).
- **Testes em série** (`fileParallelism:false`): elimina contenção de porta entre
  os testes de integração que sobem servidor HTTP (determinístico local e no CI).
- **`AUDIT.md`:** pacote de re-auditoria (mapa achado→correção→commit + checklist).
- Total: **92 testes** verdes.

## 0.5.0 — Fase 4: paridade funcional (documentos, PTY, paginação)

- **Leitura de documentos** (novas ferramentas read-only):
  - `read_pdf` (via `pdf-parse`) — extrai texto de PDF, com paginação offset/limit.
  - `read_docx` (via `mammoth`) — extrai texto de .docx.
  - `read_sheet` (via `exceljs`) — lê `.xlsx` e `.csv` → linhas JSON, com paginação.
- **Terminal interativo real (PTY)** via `@lydell/node-pty` (dependência
  **opcional** com prebuilds; fallback explícito se indisponível):
  `pty_start`/`pty_output`/`pty_write`/`pty_resize`/`pty_kill`. Passa pela mesma
  política/allowlist e aprovação; resolve o executável por PATH+PATHEXT.
- **Paginação** consolidada: `read_file` (offset/limit/tail), `job_output`
  (cursores incrementais), leitores de documento (offset/limit) e `read_sheet`
  (offset/max_rows).
- **Dependências:** `pdf-parse`, `mammoth`, `exceljs` (produção); `@lydell/node-pty`
  (opcional). `override` de `uuid` para versão corrigida → `npm audit --omit=dev` = 0.

### Testes
- 89 testes (5 novos): `read_sheet` (CSV + XLSX gerado), `read_pdf` (PDF real
  construído no teste), `read_docx` (erro gracioso), e PTY (captura de saída real).

## 0.4.3 — Fase 5: supply-chain do instalador

- **Downloads verificados (fail-closed):**
  - `ensure-node.ps1` fixa o Node em `v22.12.0`, verifica o **SHA-256** contra o
    `SHASUMS256.txt` oficial **e** a **assinatura Authenticode** do MSI.
  - `ensure-cloudflared.ps1` verifica a **assinatura Authenticode** (editor
    `Cloudflare`) antes de instalar; versão pinável via `-Version`.
- **SBOM:** o CI gera `sbom.cdx.json` (CycloneDX, só produção via `npm sbom`) e
  publica junto ao `.exe` no Release, além de `SHA256SUMS.txt` do instalador.
- **Permissões mínimas no CI:** `installer.yml` dividido em jobs `build`
  (`contents: read`) e `release` (`contents: write`, só em tags `v*`). `ci.yml`
  com `permissions: contents: read` e `npm audit --omit=dev` no pipeline.
- **Actions pinadas por commit SHA** (checkout/setup-node/upload-artifact/
  download-artifact/action-gh-release) — sem tags móveis.
- Removido do repo o `admin.secret` vazado por teste local; `*.secret` no
  `.gitignore` (valor era descartável, não credencial de produção).

## 0.4.2 — Fase 2: segurança operacional remota

Camada de operação para o produto exposto por túnel.

- **Rate limiting + lockout progressivo** por IP no `/mcp` (`RateLimiter`):
  muitas tentativas de token inválido bloqueiam o IP por tempo crescente; 429
  com `Retry-After`.
- **Limite de sessões** simultâneas (`BRIDGE_MAX_SESSIONS`, padrão 20).
- **Ownership por sessão:** cada sessão HTTP recebe seu próprio `buildServer`
  (JobManager/Watcher/env isolados) — uma sessão não enxerga/cancela jobs de
  outra (teste de regressão incluso).
- **TokenStore** com rotação/revogação em runtime (invalida o token anterior).
- **Plano de controle LOCAL** (`src/transports/admin.ts`) numa porta separada
  (`BRIDGE_PORT+1`, **não** encaminhada pelo túnel), protegido por
  `BRIDGE_ADMIN_SECRET` (gerado e salvo em `<dados>/admin.secret`, 0600):
  `/admin/rotate`, `/admin/revoke`, `/admin/panic`, `/admin/status`.
- **Painel de Controle** (`control.ps1`) ganhou **Rotacionar token**,
  **Revogar acesso remoto** e integra o **panic** ao botão de parada.
- `configure.ps1` gera `BRIDGE_ADMIN_SECRET` e grava `BRIDGE_MAX_SESSIONS`.
- Config: `dataDir`, `adminPort`, `maxSessions` validados; `/health` mínimo.

### Testes
- 84 testes (13 novos): `RateLimiter`, `TokenStore`, e integração de Fase 2
  (ownership entre 2 sessões, admin exige segredo, rotate invalida token antigo,
  panic revoga, lockout → 429).

### Ainda pendente
- **Sem dashboard hospedado / device pairing na nuvem** — o controle é local
  (o túnel é apenas transporte). Documentado, sem alegação falsa.
- Fase 4 (PDF/DOCX/XLSX, PTY, paginação) e Fase 5 (checksums/SBOM do instalador)
  — próximas.

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
