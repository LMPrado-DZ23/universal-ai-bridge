# Pacote de re-auditoria — Universal AI Bridge

Documento para o auditor. Resume o que mudou desde a auditoria de `2b78384`
(v0.4.0), mapeia cada achado anterior à sua correção e ao commit, e lista o que
re-verificar.

## Alvo a revisar

- Repositório: https://github.com/LMPrado-DZ23/universal-ai-bridge
- Tag/commit atual: **v0.6.0** (`main`)
- Diff sugerido: `2b78384..HEAD`
- Histórico de releases: v0.4.1 (segurança), v0.4.2 (Fase 2), v0.4.3 (Fase 5),
  v0.5.0 (Fase 4 leitura), v0.6.0 (Fase 4b escrita).

## Como reproduzir os gates

```bash
npm ci
npm run typecheck
npm run build
npm test              # 92 testes, arquivos em série (fileParallelism:false)
npm audit --omit=dev  # deve ser 0
git diff --check
```

## Achados anteriores → correção

| # | Achado | Correção | Onde | Teste |
|---|---|---|---|---|
| C1 | Bypass de shell por `&`/newline | `scanShellUnsafe` ciente de aspas (rejeita `; \| & < > ( )` fora de aspas, `$`/crase fora de aspas simples, controles) | `src/policy/engine.ts` | `policy.test.ts`, `stage2.test.ts` (endpoint real) |
| C2 | SSRF por redirect no download | `redirect:"manual"`, revalida cada host (A/AAAA), bloqueia privados/loopback/CGNAT/IPv6, timeout, teto de redirects e bytes | `src/tools/net.ts` | `net.test.ts`, `stage2.test.ts` |
| C3 | Symlink lido na busca | `lstat`+skip de symlink no walk + `safeResolve` antes de ler | `src/tools/search.ts` | `search.test.ts` |
| C4 | `confirm` não é aprovação humana | Modo `local` (código só no console local) + docs honestas; `confirm` documentado como 2 etapas | `src/tools/helpers.ts` | — |
| C5 | Admin ≠ acesso irrestrito | Modos safe/admin explícitos; escopo = workspace; documentado | `src/config.ts`, README | `mode.test.ts` |
| C6 | Sessão HTTP fraca | Rate limit+lockout, limite de sessões, ownership por sessão, rotação/revogação/panic local | `src/security/*`, `src/transports/{http,admin}.ts` | `ratelimit/tokens/phase2.test.ts` |
| C7 | `kill_process` PID arbitrário | Só processos do bridge; externo exige admin+`allow_external` | `src/tools/process.ts`, `src/jobs.ts` | `stage2.test.ts` |
| C8 | `set_env` variáveis sensíveis | Denylist (`PATH`,`NODE_OPTIONS`,`LD_PRELOAD`,…) | `src/tools/env.ts` | `stage2.test.ts` |
| C9 | Docker `shell:true` sem parser | Mesmo `scanShellUnsafe` nos args | `src/tools/docker.ts` | — |
| C10 | Sem limites agregados | Teto de saída/arquivo/watch/jobs; leitura paginada | vários | — |
| C11 | `/health` vaza caminho | `/health` → `{ok:true}` | `src/transports/http.ts` | `integration.http.test.ts` |
| C12 | Auditoria frágil | append-only, sanitiza args, nunca derruba a operação | `src/audit/log.ts` | — |
| C13 | Config aceita inválidos | Fail-closed: porta 1–65535, modo/approval válidos, token forte anti-placeholder | `src/config.ts` | `config.test.ts` |
| C14 | `.env` com BOM | UTF-8 sem BOM em `configure.ps1` e `setup.ps1` | `installer/scripts/*` | — |
| C15 | Downloads sem checksum | Node: SHA-256 (SHASUMS) + Authenticode; cloudflared: Authenticode (fail-closed) | `installer/scripts/ensure-*.ps1` | — |
| C16 | Actions sem SHA / perm ampla | Actions pinadas por SHA; `contents:write` só no job de release | `.github/workflows/*` | — |
| C17 | Versão divergente | Versão única em package/server/Inno | — | — |
| C18 | Arquivos-lixo + NUL | Removidos; `search.ts` reescrito UTF-8; `*.secret`/lixo no `.gitignore` | — | — |

## O que re-verificar com prioridade

1. **C1** no endpoint MCP real: `run_command` com `&`, newline, `$()`, crase → bloqueado; `node -e "console.log(1>0)"` → permitido (arg entre aspas).
2. **C2**: um domínio público que redireciona para `127.0.0.1` deve ser bloqueado no salto final (teste com servidor de redirect ao vivo — cobrimos por unidade em `isPrivateIp` + `manual`).
3. **C3**: symlink de arquivo dentro do workspace apontando para fora não deve ser lido por `search_content`/`read_*`.
4. **Fase 2**: rotação invalida token antigo; `panic` revoga e derruba; lockout retorna 429; ownership entre sessões.
5. **Fase 5**: no CI, `installer.yml` verifica assinatura dos downloads e publica SBOM+SHA256SUMS; `contents:write` só no `release`.

## Limitações honestas (não são bugs)

- **Isolamento real**: no modo admin, comandos/Docker/PTY rodam com os privilégios
  do usuário. É guardrail, não sandbox — isolamento forte exige usuário
  dedicado/VM/Docker rootless (documentado no README).
- **DevDependencies**: `vitest`/`vite`/`esbuild` têm advisories **só de dev**
  (`npm audit --omit=dev` = 0); correção exige major bump do Vitest bloqueado por
  ERESOLVE; não afeta produção.
- **Sem dashboard hospedado / device pairing na nuvem**: o controle é local; o
  túnel é apenas transporte.
- **`.exe` não assinado** por padrão: a infra de assinatura existe e ativa com um
  certificado (secret do CI); sem ele, o SmartScreen alerta.
- **`admin.secret` inócuo em commit antigo** (`f6120a4`): valor descartável de
  teste, já removido do HEAD e `gitignored`; não é credencial de produção.
