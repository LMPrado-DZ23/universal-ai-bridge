# Instalador Windows — preview

O instalador Inno Setup é um caminho de distribuição em validação. Build do EXE
não comprova instalação, upgrade, logon, GUI, túnel ou desinstalação em máquina
limpa. Não se trata de uma release homologada para leigos.

## Gerar e verificar

A PR e qualquer mudança em `main` executam `.github/workflows/installer.yml`, sem
filtros que deixem arquivos empacotados de fora. O workflow instala dependências,
verifica fontes, build, tipos, testes, auditoria completa e produção, scripts
PowerShell, gera SBOM, compila o EXE e publica SHA-256.

Branches/workflow manual geram o artifact `preview-unsigned-assets`, contendo
`UniversalAI-Bridge-Setup-preview-unsigned.exe`, SBOM, SHA256SUMS e SIGNING-STATUS.
Tags `v*` **falham** sem `CODE_SIGN_PFX_BASE64` e `CODE_SIGN_PASSWORD` ou sem
Authenticode válido. Assinatura usa certificado em memória; senha não vai em argv.
Uma assinatura válida não garante reputação SmartScreen. Não crie tag até decisão
do usuário após CI verde e homologação Windows.

## Comportamento previsto

- Instalacao nova usa conexao local por padrao, sem baixar/iniciar Cloudflare.
  O wizard oferece acesso remoto por opt-in; a escolha persiste como
  `BRIDGE_CONNECTION=local|remote`. Upgrade preserva a configuracao existente.
- Safe é padrão; terminal desligado; Docker desligado. Admin exige frase explícita.
- Node MSI fixado em **22.23.2**, hash versionado e editor OpenJS Foundation.
  Runtime já instalado e compatível é reutilizado; sua origem é responsabilidade
  do administrador. Não há fallback de download para `latest`.
- cloudflared **2025.8.1**, hash versionado e assinatura/editor Cloudflare válidos,
  inclusive em binário existente. Se o artefato oficial não cumprir a verificação,
  a instalação para; não há bypass.
- Configuração usa arquivo temporário privado, flush e substituição atômica.
  Reexecução preserva configurações e revogação; opções explícitas mudam somente
  as chaves correspondentes. Upgrade pelo wizard preserva o `.env` existente.
- Launcher valida portas MCP/admin antes de criar processos, aguarda health e
  registra caminho, command line e criação de cada PID. Falha encerra somente
  processos identificados da tentativa. Isso não é rollback transacional do EXE.
- Túnel nomeado passa token por arquivo privado; somente MCP, nunca admin, deve
  ser encaminhado. URL rápida é temporária e não é deployment permanente seguro.
- Tarefa de logon usa o usuário com RunLevel Limited. Instalação exige UAC.
- Painel diferencia health do bridge e processo do túnel. Processo ativo não
  comprova conectividade externa. Copiar token exige escolha explícita.
- Aprovação human_local é feita no painel Windows. Não há GUI Linux/macOS.
- Parada valida identidade antes de taskkill. Desinstalação preserva workspace,
  credenciais e auditoria; purga requer opção explícita.

O teste `scripts/test-installed-lifecycle.ps1` cobre inicio local, MCP autenticado,
rotacao/reinicio, revogacao persistida, preservacao de dados e PID externo, parada
e limpeza repetidas. JSON de estado corrompido deve falhar com codigo nao zero.
Ele usa uma copia da aplicacao; nao executa o assistente EXE.

## Homologação necessária

Em VM Windows limpa: instalar, configurar safe/admin, negar checksum/assinatura
inválidos, testar ACL negada e porta ocupada, iniciar sem túnel e com túnel real,
aprovar/recusar ações, rotacionar/revogar/reiniciar, atualizar preservando dados,
parar duas vezes e desinstalar preservando dados. Testar também falha de instalação
no meio, pois rollback transacional completo não está implementado.

`BLOCKED_BY_EXTERNAL_DEPENDENCY`: certificado de assinatura, domínio/conta
Cloudflare e contas/clientes comerciais. CI valida PowerShell, build e ciclo local dos scripts com servidor real; uma sessão
Windows interativa ainda é necessária para homologar WinForms e o ciclo do wizard.

Para uso pelo código-fonte, siga o README raiz e `npm run doctor`. O HTTP MCP não
implica suporte automático a headers personalizados em ChatGPT/Claude web.


### Ciclo do EXE em CI

`scripts/test-windows-exe.ps1` instala o EXE real silenciosamente em Windows,
confere MCP autenticado e tarefa com privilégio limitado, atualiza e desinstala,
preservando dados. Também exige falha explícita ao reinstalar com token revogado.
Os resultados e logs sanitizados são publicados em `windows-exe-validation`.
A pós-instalação espera a partida da tarefa por até 45 segundos; falha de saúde
ou autenticação produz código 10. Dados e instalação parcial podem permanecer
para diagnóstico. Isso não substitui validação interativa do wizard/UAC/WinForms.
