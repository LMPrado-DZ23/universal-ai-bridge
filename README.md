# Universal AI Bridge

Um **servidor MCP local** que deixa **qualquer IA que fale MCP** — no navegador
(ChatGPT, Claude.ai) ou local (Claude Desktop, Cursor, Gemini CLI) — programar no
seu PC: criar/editar projetos, rodar terminal (inclusive tarefas longas e
interativas) e, no modo admin, usar Docker. **Com dois modos de segurança
claramente separados.**

Um código, dois transportes:

- **stdio** → clientes MCP locais (sem rede, sem token).
- **Streamable HTTP** → IAs no navegador, via túnel HTTPS (`cloudflared`).

Arquitetura: `IA → Auth → Policy Engine → Executor → Audit`.

## ⬇️ Download (Windows)

Baixe o instalador pronto em **[Releases](https://github.com/LMPrado-DZ23/universal-ai-bridge/releases/latest)** →
`UniversalAI-Bridge-Setup.exe`. Execute, siga o assistente e conecte ao ChatGPT.
(O `.exe` não é assinado; o SmartScreen pode pedir "Mais informações → Executar assim mesmo".)

Prefere rodar do código? Veja [Instalação](#2-instalação).

---

## Sumário

1. [Modos de segurança](#1-modos-de-segurança)
2. [Instalação](#2-instalação)
3. [Configuração `.env`](#3-configuração-env)
4. [Claude Desktop / Cursor / Gemini CLI (stdio)](#4-claude-desktop--cursor--gemini-cli-stdio)
5. [ChatGPT / Claude.ai no navegador (HTTP + túnel)](#5-chatgpt--claudeai-no-navegador-http--túnel)
6. [Terminal e tarefas longas](#6-terminal-e-tarefas-longas)
7. [Docker (modo admin)](#7-docker-modo-admin)
8. [Tokens](#8-tokens)
9. [Logs / auditoria](#9-logs--auditoria)
10. [Desligamento de emergência](#10-desligamento-de-emergência)
11. [Recuperação após erro](#11-recuperação-após-erro)
12. [Riscos de acesso total](#12-riscos-de-acesso-total)
13. [Multiplataforma](#13-multiplataforma)
14. [Ferramentas](#14-ferramentas)

---

## 1. Modos de segurança

O modo é escolhido por `BRIDGE_MODE`.

### Modo seguro (`safe`) — padrão

- Workspace **jaulado** (nada sai da pasta configurada; symlinks para fora são bloqueados).
- Shell **desligado** por padrão; liga só com `BRIDGE_ALLOW_SHELL=true`.
- Docker **sempre bloqueado**.
- Ações com efeito colateral passam por aprovação (`confirm` ou `local`).

### Modo administrador (`admin`) — opt-in deliberado

- Shell **ligado** por padrão; Docker liberável com `BRIDGE_ALLOW_DOCKER=true`.
- **Exige reconhecimento explícito**: `BRIDGE_ADMIN_ACK=I_UNDERSTAND_FULL_PC_ACCESS`.
  Sem essa frase exata, o servidor **não sobe** em modo admin (cai para safe/erro).
- Continua com workspace jaulado (o escopo é a raiz do workspace — amplie-a
  conscientemente se precisar).

> ⚠️ **No modo administrador, qualquer pessoa que obtenha os tokens necessários
> poderá executar ações com os privilégios do processo no computador.**

Recomendação: rode o modo admin em um **usuário dedicado do sistema ou VM**, e
exponha o HTTP apenas atrás de VPN/Cloudflare Access — nunca por uma URL pública
permanente.

---

## 2. Instalação

Requer **Node.js 22+**.

```bash
git clone https://github.com/LMPrado-DZ23/universal-ai-bridge.git
cd universal-ai-bridge
npm install
npm run build
```

No Windows, um atalho faz install + build + gera o `.env` com token criptográfico:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

---

## 3. Configuração `.env`

Copie `env.example` para `.env`. O servidor **carrega o `.env` automaticamente**
(via `process.loadEnvFile`, nativo do Node 22). Gere um token forte:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variável | Efeito |
|---|---|
| `BRIDGE_MODE` | `safe` (padrão) ou `admin`. |
| `BRIDGE_ADMIN_ACK` | Só admin: precisa ser `I_UNDERSTAND_FULL_PC_ACCESS`. |
| `BRIDGE_TOKEN` | Token Bearer do HTTP. Sem ele, o HTTP não sobe. |
| `BRIDGE_PORT` | Porta loopback (padrão 8787). |
| `BRIDGE_ALLOWED_ORIGINS` | Origins permitidos (CSV) — anti DNS-rebinding. |
| `BRIDGE_WORKSPACE` | Raiz jaulada. Vazio = `./workspace`. |
| `BRIDGE_APPROVAL` | `auto` · `confirm` (padrão) · `local`. |
| `BRIDGE_ALLOW_SHELL` | `true` liga o terminal (obrigatório no safe). |
| `BRIDGE_ALLOW_DOCKER` | `true` libera Docker (só tem efeito no admin). |

---

## 4. Claude Desktop / Cursor / Gemini CLI (stdio)

Não precisa de túnel. Aponte o cliente para o transporte **stdio**.

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "universal-ai-bridge": {
      "command": "node",
      "args": ["C:\\caminho\\para\\universal-ai-bridge\\dist\\index.js", "--transport", "stdio"],
      "env": {
        "BRIDGE_WORKSPACE": "C:\\caminho\\para\\ai-workspace",
        "BRIDGE_ALLOW_SHELL": "true"
      }
    }
  }
}
```

> No Linux/macOS use caminhos POSIX (ex.: `/home/voce/universal-ai-bridge/dist/index.js`).
> **Gemini CLI**: mesma estrutura em `~/.gemini/settings.json` sob `mcpServers`.

---

## 5. ChatGPT / Claude.ai no navegador (HTTP + túnel)

O navegador só conecta em MCP **remoto (HTTPS)**.

```bash
npm run start:http
```

Escuta só em `http://127.0.0.1:8787/mcp`. Exponha com cloudflared:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

O cloudflared devolve uma URL `https://...trycloudflare.com`. O endpoint MCP é
`https://.../mcp`.

**URL fixa (túnel nomeado):** o túnel rápido muda de URL a cada reinício. Para uma
URL estável, crie um **túnel nomeado** no painel da Cloudflare (requer sua conta +
um domínio na Cloudflare), mapeie o hostname para `http://127.0.0.1:8787`, e ponha
no `.env`:

```env
CLOUDFLARE_TUNNEL_TOKEN=<token do túnel nomeado>
TUNNEL_HOSTNAME=bridge.seudominio.com
```

O launcher passa a usar `cloudflared tunnel run --token …` (URL fixa) em vez do
túnel efêmero, automaticamente.

- **ChatGPT** (Settings → Connectors / modo desenvolvedor): adicione conector MCP com
  a URL `/mcp` e header `Authorization: Bearer <BRIDGE_TOKEN>`.
- **Claude.ai** (Settings → Connectors → custom): mesma URL e header.
- Cole o conteúdo de [`SKILL.md`](./SKILL.md) nas instruções do GPT/projeto.

> Túnel público temporário serve para teste. Para uso permanente, prefira
> Cloudflare Access / VPN.

---

## 6. Terminal e tarefas longas

Disponível quando `shell_enabled: true`.

- **Comando curto:** `run_command` executa e espera terminar.
- **Tarefa longa / streaming:** `run_job` retorna um `job_id`; `job_output` devolve
  a saída incremental (passe os cursores retornados para acompanhar em tempo real).
- **Interativo:** `job_write` envia texto ao stdin do processo.
- **Cancelamento:** `job_cancel` encerra o job **e toda a árvore de processos-filho**
  (`taskkill /T` no Windows, kill de grupo no POSIX).

Só binários da allowlist (`config/policy.json`) rodam; encadeamento e
redirecionamento (`&& | ; > <`) são bloqueados.

> **`run_command`/`run_job` não são uma sandbox.** Rodam com os privilégios do
> processo; binários capazes de executar código (node, python) podem alcançar
> caminhos fora do workspace. Para isolamento real, use usuário/VM dedicados.

---

## 7. Docker (modo admin)

Bloqueado no modo safe. No admin, com `BRIDGE_ALLOW_DOCKER=true`, a ferramenta
`docker` roda `docker <args>` como job (ex.: `docker build -t app .`).

> Acesso ao Docker do host costuma equivaler a **root**. Prefira Docker rootless
> ou um daemon/VM separada.

---

## 8. Tokens e controle operacional

- O token do HTTP fica em `BRIDGE_TOKEN` (no `.env`, git-ignored). Comparação em
  tempo constante; nunca é logado.
- **Rate limiting + lockout progressivo:** requisições por IP são limitadas e um
  IP com muitas tentativas de token inválido é bloqueado por um tempo crescente.
- **Limite de sessões:** `BRIDGE_MAX_SESSIONS` (padrão 20) simultâneas.
- **Ownership por sessão:** cada sessão HTTP tem seu próprio conjunto de jobs,
  watches e variáveis — **uma sessão não vê nem cancela jobs de outra**.
- **Plano de controle LOCAL** numa porta separada (`BRIDGE_PORT+1`, **não**
  encaminhada pelo túnel), protegido por `BRIDGE_ADMIN_SECRET`
  (`<dados>/admin.secret`). Ações:
  - `POST /admin/rotate` — gera um novo token (o antigo para de valer na hora).
  - `POST /admin/revoke` — revoga o token e fecha as sessões (bridge segue de pé).
  - `POST /admin/panic` — **parada de emergência**: mata jobs/watches, fecha
    sessões e revoga o token.
  - `POST /admin/status` — nº de sessões e se há token (sem segredos).
  O **Painel de Controle** (Windows) tem botões para tudo isso.

> **Honestidade:** o controle é **local** (nesta máquina). Não há dashboard
> hospedado nem pareamento de dispositivos na nuvem — o túnel é só transporte.
> Se um token vazar, use **Rotacionar** ou **Revogar** no painel (ou o endpoint
> local) — não é preciso editar o `.env` à mão.

- Nunca compartilhe o token nem o cole em páginas/repos.

---

## 9. Logs / auditoria

- Auditoria append-only em `audit/audit-AAAA-MM-DD.jsonl`.
- Registra ferramenta, decisão (allow/deny/executed/…), metadados e resultado —
  **nunca** conteúdo integral de arquivos nem segredos.
- Falha de escrita do log **não derruba** a operação (é silenciosa).

---

## 10. Desligamento de emergência

- Feche o processo do servidor (`Ctrl+C`, ou encerre a janela/serviço).
- Ao receber `SIGINT`/`SIGTERM`, o servidor **mata todos os jobs** (árvore de
  processos) e fecha as sessões HTTP antes de sair.
- Corte imediato do acesso remoto: **pare o `cloudflared`** (o túnel some).
- Revogação: troque o `BRIDGE_TOKEN` e reinicie.

---

## 11. Recuperação após erro

- Erros de rede/desconexão no HTTP são tratados e **não derrubam** o processo.
- Sessões HTTP ociosas expiram (30 min) e são limpas automaticamente.
- Rejeições não tratadas são apenas logadas em stderr.
- Se um job travar, use `job_cancel`; se o servidor cair, basta reiniciar
  (`npm run start:http` ou o cliente stdio) — o estado vive no disco (workspace).

---

## 12. Riscos de acesso total

Dar a uma IA acesso ao seu computador é poderoso e perigoso:

- No **modo admin**, quem tiver o token pode agir com os privilégios do processo.
- `run_command`/Docker **não isolam** o host.
- Um prompt malicioso ou uma sessão de navegador roubada pode disparar ações.

Mitigações: mantenha o **modo safe** por padrão; use aprovação `local`; rode admin
em usuário/VM dedicados; exponha só atrás de VPN/Access; gire tokens; revise o
`audit/`.

---

## 13. Multiplataforma

- **Windows:** suportado (setup.ps1, `taskkill /T` para matar árvore de processos).
- **Linux / macOS:** suportado (kill de grupo de processos via `detached`).
  Use caminhos POSIX no `.env` e nas configs dos clientes; o token pode ser gerado com
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Symlinks: a jaula resolve o caminho real em todos os SOs (no Windows, a criação
  de symlink pode exigir modo desenvolvedor — não afeta a proteção).

---

## 14. Ferramentas

**Arquivos e busca:** `get_workspace_info`, `list_dir`, `read_file` (parcial:
offset/limit/tail), `read_multiple_files`, `get_file_info`, `read_media_file`,
`write_file`, `edit_file` (regex / todas ocorrências), `make_dir`, `move_path`,
`create_project`, `search_files`, `search_content` (grep).
**Documentos (ler):** `read_pdf`, `read_docx`, `read_sheet` (XLSX/CSV) — com paginação.
**Documentos (criar):** `write_sheet` (XLSX/CSV), `write_docx`, `write_pdf`.
**Monitoramento e política:** `watch_start`, `watch_poll`, `watch_stop`, `get_policy`.
**Terminal e processos:** `run_command`, `run_job`, `job_status`, `job_output`,
`job_write`, `job_cancel`, `pty_start`/`pty_output`/`pty_write`/`pty_resize`/`pty_kill`
(terminal interativo real), `list_processes`, `kill_process`, `set_env`,
`unset_env`, `list_env`.
**Modo admin:** `docker`, `manage_allowlist`, `download_to_file`.

### Comparação com o Desktop Commander

O Desktop Commander também oferece controle remoto por MCP, documentos,
preview, streaming, sessões, histórico, Docker e opções de instalação.
Referência: https://github.com/wonderwhy-er/DesktopCommanderMCP .
Não há evidência nesta auditoria para declarar superioridade ou paridade completa.
O foco verificado do Bridge é controle explícito de política, sessões, aprovação e audit.

Fluxo de uso detalhado em [`SKILL.md`](./SKILL.md). Política em
[`config/policy.json`](./config/policy.json).

---

## Licença

MIT — veja [`LICENSE`](./LICENSE).


## Revisão local de segurança sobre v0.7.0

Esta revisão ainda não foi publicada. Veja `AUDIT.md` para evidências e lacunas.

- `run_command` aguarda um processo assíncrono, sem bloquear `/health`; informa exit code, timeout e truncamento. Usa as mesmas cotas de `run_job` e termina no encerramento da sessão.
- `program + args` evita interpretação por shell para executáveis nativos. `.cmd/.bat` precisa de `cmd.exe` no Windows com validação restrita. Allowlist e `shell:false` são guardrails, não isolamento de programas autorizados.
- Tokens manuais precisam ter formato de 32 bytes: 64 caracteres hexadecimais ou 43 base64url. O formato não prova entropia: gere com `randomBytes(32)`; não escolha texto previsível. Tokens antigos curtos exigem migração manual.
- Flags booleanas aceitam somente `true`/`false`. Configuração inválida bloqueia a inicialização; política é validada por schema.

### Aprovação e operação local

`confirm` é confirmação lógica no canal da IA. `local` ainda exige que o humano
entregue um código à IA. `human_local` exige decisão no painel Windows: configure
`BRIDGE_APPROVAL=human_local`, abra o painel e escolha **Aprovar / Recusar ações**.
A IA recebe um identificador, mas só pode executar os mesmos argumentos após a
aprovação local. Ações grandes que não cabem no preview são recusadas. A GUI
precisa de validação em Windows real. Este modo depende do plano administrativo
HTTP; não o configure em stdio. Programas já autorizados rodam com seus privilégios:
nenhuma aprovação torna execução arbitrária sob o mesmo usuário uma sandbox.

Rotacionar pelo painel retorna `persistence=persisted`, `memory-only` ou `failed`.
Em falha, o token novo vale apenas em memória; corrija a escrita/ACL antes de reiniciar.
Revogação também tenta persistir token vazio; se falhar, reinício pode restaurar o
valor antigo. A UI/API informa a persistência. Arquivos privados usam 0600 no POSIX
e ACL explícita para o usuário no Windows; erro de ACL bloqueia a escrita privada.
O `.env` deve ter precedência operacional: um BRIDGE_TOKEN herdado no ambiente do
serviço pode sobrepor o arquivo no próximo boot e deve ser atualizado/removido.

### Limites padrão

| Recurso | Limite |
|---|---:|
| Jobs ativos por sessão / global | 4 / 32 |
| Jobs retidos por sessão / TTL após terminar | 32 / 5 minutos |
| PTYs retidos por sessão / TTL após terminar | 4 / 5 minutos |
| Watchers por sessão | 8 |
| Confirmações pendentes / TTL | 64 / 5 minutos |
| Escrita stdin ou PTY | 65.536 bytes |
| Requests HTTP concorrentes por sessão | 4 |
| Saída retida por manager de jobs / PTYs | 4 MB cada |
| Documentos de entrada / expansão ZIP | 2 MB / 16 MB |
| Planilha: linhas / colunas / células totais | 10.000 / 100 / 100.000 |
| Texto extraído / PDF | 200.000 caracteres / 200 páginas |
| Parsing / regex e busca | 10 s / 5 s |
| Workers globais | 4; heap V8 128 MB por worker |
| Busca | 20.000 entradas, 20 MB, 200.000 linhas |
| Ler múltiplos / criar projeto | 32 / 64 arquivos; teto agregado da política |
| Audit | rotação ~1 MB, até 8 arquivos, 7 dias |

Os limites de recursos são configuráveis com `BRIDGE_LIMIT_ACTIVE_JOBS`,
`GLOBAL_JOBS`, `RETAINED_JOBS`, `PTYS`, `WATCHERS`, `CONFIRMATIONS`, `STDIN_BYTES`,
`JOB_TTL_MS`, `CONFIRMATION_TTL_MS`, `CONCURRENT_REQUESTS`, `OUTPUT_BYTES` (todos
com prefixo `BRIDGE_LIMIT_`). Cada valor aceita de 1 a quatro vezes seu padrão.
O heap V8 não limita toda memória nativa: use limites do SO/VM para isolamento real.
ExcelJS ainda carrega o arquivo limitado no worker; somente a página é materializada
como linhas de resposta. Arquivos maiores devem ser divididos externamente.
`BRIDGE_AUDIT_REQUIRED=true` bloqueia ações protegidas pelo gate quando não consegue
gravar a intenção antes da execução; audit registra hashes e tamanhos, sem conteúdo.

### Instalação e diagnóstico desta revisão

1. Instale Node.js 22.12+ (ou Node 24) e extraia o código revisado numa pasta nova.
2. Abra o terminal nessa pasta e rode `npm ci`, `npm run build`, `npm test`.
3. Copie `env.example` para `.env`, configure seu workspace e gere um token:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Mantenha `BRIDGE_MODE=safe`. Inicie com `npm run start:http`.
5. Em outro terminal na mesma pasta, rode `npm run doctor` para testar autenticação,
   inicialização MCP e listagem real de ferramentas. Ele fecha a sessão criada.
6. Clientes MCP locais: use a configuração stdio da seção 4. Para clientes remotos,
   configure endpoint HTTPS `/mcp` e autenticação Bearer se o cliente suportar esse
   método. A compatibilidade com a conta/interface atual de ChatGPT ou Claude.ai
   precisa de teste real; a presença de HTTP sozinho não comprova essa integração.

O túnel rápido tem URL efêmera; o nomeado depende da sua conta/domínio Cloudflare.
No launcher, credencial nomeada fica em `tunnel.token` com ACL, passada por
`--token-file`, nunca por `--token <segredo>`. O token dá acesso ao túnel e não deve
ser compartilhado. Binário fixado em 2025.8.1, SHA256 e assinatura/editor são exigidos
inclusive para executável existente. Se o binário oficial estiver sem assinatura
válida, a instalação falha; não há downgrade de segurança nem fallback latest.
Referência: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/ .

Parada valida PID, caminho, linha de comando e data de criação registrados. Estado
antigo sem identidade não é suficiente para encerrar processos. Isso reduz risco
de PID reutilizado, mas não é uma operação atômica do kernel. `ExecutionPolicy Bypass`
nos atalhos existentes permite executar scripts sem a política local; não equivale
a assinatura ou verificação criptográfica. O instalador continua sem assinatura
quando não há certificado configurado. Não considere esta revisão release homologada.
