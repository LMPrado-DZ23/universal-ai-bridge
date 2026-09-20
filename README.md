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

O cloudflared devolve uma URL `https://...trycloudflare.com`. Acrescente esse host
em `BRIDGE_ALLOWED_ORIGINS` e reinicie. O endpoint MCP é `https://.../mcp`.

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

## 8. Tokens

- O token do HTTP fica em `BRIDGE_TOKEN` (no `.env`, que é git-ignored).
- Comparação em tempo constante (`timingSafeEqual`); nunca é logado.
- **Rotação:** gere um novo token, atualize o `.env`, reinicie o servidor e o
  conector. Sessões antigas param de valer.
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
offset/limit/tail), `read_multiple_files`, `get_file_info`, `write_file`,
`edit_file` (regex / todas ocorrências), `make_dir`, `move_path`,
`create_project`, `search_files`, `search_content` (grep).
**Terminal e processos:** `run_command`, `run_job`, `job_status`, `job_output`,
`job_write`, `job_cancel`, `list_processes`, `kill_process`.
**Docker (admin):** `docker`.

### Comparação com o Desktop Commander

O Desktop Commander é excelente, mas só fala **stdio** (clientes locais). O
Universal AI Bridge cobre o mesmo terreno de arquivos/terminal **e** vai além:

| | Universal AI Bridge | Desktop Commander |
|---|---|---|
| IAs no navegador (ChatGPT/Claude.ai) | ✅ MCP remoto + túnel | ❌ só stdio |
| Modos safe/admin + policy + audit + aprovação local | ✅ | parcial |
| Instalador 1-clique (Windows) | ✅ | ❌ |
| Arquivos (ler parcial, multi, info, editar regex) | ✅ | ✅ |
| Busca por nome e conteúdo (grep) | ✅ | ✅ |
| Jobs longos/interativos/cancel + processos | ✅ | ✅ |

Fluxo de uso detalhado em [`SKILL.md`](./SKILL.md). Política em
[`config/policy.json`](./config/policy.json).

---

## Licença

MIT — veja [`LICENSE`](./LICENSE).
