# Universal AI Bridge

Um **servidor MCP local** que deixa **qualquer IA que fale MCP** — no navegador
(ChatGPT, Claude.ai) ou local (Claude Desktop, Cursor, Gemini CLI) — criar, ler,
editar e executar projetos no seu PC, **com segurança**.

Um código, dois transportes:

- **stdio** → clientes MCP locais (sem rede, sem token).
- **Streamable HTTP** → IAs no navegador, via túnel HTTPS (`cloudflared`).

Arquitetura: `IA → Auth → Policy Engine → Executor → Audit log`.
Tudo o que a IA faz fica **preso a uma pasta `workspace/`** e passa por uma
política determinística + aprovação humana.

---

## 1. Instalar

```bash
git clone https://github.com/LMPrado-DZ23/universal-ai-bridge.git
cd universal-ai-bridge
npm install
npm run build
```

No Windows, há um atalho que faz install + build + gera o `.env` com token:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Copie `env.example` para `.env` e ajuste. Gere um token forte:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole em `BRIDGE_TOKEN` no `.env`.

---

## 2. Usar com clientes locais (Claude Desktop / Cursor / Gemini CLI)

Não precisa de túnel. Aponte o cliente para o transporte **stdio**.

**Claude Desktop** — em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "universal-ai-bridge": {
      "command": "node",
      "args": ["C:\\caminho\\para\\universal-ai-bridge\\dist\\index.js", "--transport", "stdio"],
      "env": { "BRIDGE_WORKSPACE": "C:\\caminho\\para\\ai-workspace" }
    }
  }
}
```

> Troque `C:\\caminho\\para\\...` pelo caminho real onde você clonou o projeto.

**Gemini CLI** — em `~/.gemini/settings.json`, mesma ideia sob `mcpServers`.

---

## 3. Usar no navegador (ChatGPT / Claude.ai)

O navegador só conecta em MCP **remoto (HTTPS)**. Fluxo:

### a) Suba o servidor HTTP (loopback)

```bash
npm run start:http
```

Ele escuta só em `http://127.0.0.1:8787/mcp`.

### b) Exponha via cloudflared

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

O cloudflared devolve uma URL tipo `https://algo-aleatorio.trycloudflare.com`.
**Acrescente o host dela** em `BRIDGE_ALLOWED_ORIGINS` no `.env` e reinicie
(`BRIDGE_ALLOWED_ORIGINS=...,https://algo-aleatorio.trycloudflare.com`).

O endpoint MCP final é `https://algo-aleatorio.trycloudflare.com/mcp`.

### c) Registre o conector

- **ChatGPT** (Settings → Connectors / modo desenvolvedor): adicione um conector
  MCP com a URL `/mcp` e, na autenticação, header
  `Authorization: Bearer <seu BRIDGE_TOKEN>`.
- **Claude.ai** (Settings → Connectors → Add custom connector): mesma URL e
  header.

### d) Ensine a skill

Cole o conteúdo de [`SKILL.md`](./SKILL.md) nas instruções personalizadas do
GPT/projeto, ou instale como skill onde a plataforma permitir.

---

## 4. Segurança (o que já vem ligado)

| Camada | Proteção |
|---|---|
| **Jaula** | Tudo preso a `workspace/`; `..` e caminhos absolutos são rejeitados. |
| **Auth** | HTTP exige `Bearer <token>` (comparação constante-tempo). Sem token, o HTTP nem sobe. |
| **Origin** | Checagem de `Origin` + proteção DNS-rebinding do SDK. |
| **Loopback** | O HTTP escuta só em `127.0.0.1`; a exposição externa é só pelo túnel. |
| **Policy Engine** | Allowlist/denylist de comandos, bloqueio de `rm -rf`/`DROP`/etc., sem encadeamento, limite de tamanho e extensões proibidas. |
| **Aprovação** | Ações com efeito colateral exigem `confirm_token` (modo `confirm`). |
| **Audit** | Tudo em `audit/audit-AAAA-MM-DD.jsonl` (append-only, sem conteúdo/segredos). |

Ajuste a política em [`config/policy.json`](./config/policy.json).

---

## 5. Ferramentas

`get_workspace_info`, `list_dir`, `read_file`, `write_file`, `edit_file`,
`make_dir`, `move_path`, `create_project`, `run_command`.

Detalhes e fluxo de uso em [`SKILL.md`](./SKILL.md).
