# Instalador Windows — `UniversalAI-Bridge-Setup.exe`

Transforma o Universal AI Bridge num produto para leigos: o usuário roda um único
`.exe`, segue um assistente e termina com o bridge instalado, iniciado
automaticamente e pronto para conectar ao ChatGPT.

## Como o usuário final usa

1. Baixa `UniversalAI-Bridge-Setup.exe` (gerado pelo CI — veja abaixo) e executa.
2. Aceita a elevação do Windows (UAC).
3. O assistente verifica o Windows (10/11 x64), escolhe a pasta e o **modo**:
   - **Seguro** (padrão): arquivos isolados numa pasta, terminal e Docker desligados.
   - **Administrador**: acesso amplo. Exige digitar a frase exata
     `I_UNDERSTAND_FULL_PC_ACCESS`.
4. O instalador então, automaticamente:
   - garante o **Node.js 22+** (winget ou MSI oficial);
   - baixa o **cloudflared**;
   - gera um **token** com RNG criptográfico e grava a config em
     `%LOCALAPPDATA%\UniversalAIBridge\.env`;
   - registra uma **Tarefa Agendada** que inicia o bridge no logon e a inicia agora;
   - sobe o **túnel** e testa `/health` + handshake MCP;
   - copia o **endpoint** para a área de transferência e abre a página de
     **conectores do ChatGPT**.
5. Ao final, abre o **Painel de Controle** com: status do bridge e do túnel,
   endpoint, e botões **Abrir ChatGPT**, **Copiar endpoint**, **Religar acesso**,
   **Parar acesso imediatamente** e **Desinstalar**.

No ChatGPT, o usuário cola a URL `/mcp` como conector e adiciona o header
`Authorization: Bearer <token>` (o token está no `.env`; o painel lembra disso).

## O que exige confirmação do usuário (por segurança)

O instalador **não burla** UAC, login do ChatGPT nem autorização. O usuário
confirma explicitamente: a elevação (UAC), o **modo administrador** (digitando a
frase), a conexão no ChatGPT e as permissões do app MCP. O **modo seguro é o
padrão**.

## Como gerar o `.exe`

O `.exe` é compilado pelo **GitHub Actions** (`.github/workflows/installer.yml`)
num runner Windows, e publicado como **artifact** (e como asset de Release quando
há uma tag `v*`). Para baixar: aba **Actions → Build Windows Installer → artifact
`UniversalAI-Bridge-Setup`**.

Para compilar localmente (precisa de [Inno Setup 6](https://jrsoftware.org/isdl.php)):

```powershell
npm ci
npm run build
npm prune --omit=dev
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\UniversalAI-Bridge.iss
# saída: installer\Output\UniversalAI-Bridge-Setup.exe
```

## Arquivos

- `UniversalAI-Bridge.iss` — script do instalador (wizard, modo, pós-instalação).
- `scripts\configure.ps1` — gera token e escreve o `.env`.
- `scripts\ensure-node.ps1` / `ensure-cloudflared.ps1` — runtime.
- `scripts\install-task.ps1` — Tarefa Agendada de logon.
- `scripts\launcher.ps1` — inicia bridge + túnel e grava `state.json`.
- `scripts\healthcheck.ps1` — testa `/health` e handshake MCP.
- `scripts\stop-access.ps1` — parada de emergência.
- `scripts\uninstall-cleanup.ps1` — limpeza na desinstalação.
- `control\control.ps1` — painel de controle (WinForms).

## Limitações honestas

- O túnel gratuito (`trycloudflare`) gera uma **URL nova a cada reinício**. O
  painel sempre mostra o endpoint atual (botão **Copiar endpoint**); se o bridge
  reiniciar, o usuário recola a URL no ChatGPT. Para URL fixa, use um túnel
  nomeado do Cloudflare (requer conta) ou VPN.
- O `.exe` do CI **não é assinado** — o SmartScreen do Windows pode alertar
  ("Mais informações → Executar assim mesmo"). Assinatura de código exige um
  certificado do mantenedor.
- O bridge roda com os **privilégios do usuário logado** (não SYSTEM). No modo
  admin isso significa acesso amplo aos arquivos/contas desse usuário.
