# Auditoria e revisão local — Universal AI Bridge v0.7.0

## Origem e escopo

Base upstream: tag `v0.7.0`, commit `5c3b0504b483baa825449c60475226f3b5adbc76`.
Os 82 arquivos foram obtidos pelo conector GitHub; todos os hashes Git dos blobs
coincidem com a base. O clone por terminal não tinha conectividade; criou-se um
baseline Git local para revisão, sem representar esse commit local como upstream.
`evidence/source-provenance.json` registra a conferência.

A base foi reproduzida com **112 testes em 21 arquivos**. Esta revisão adiciona
correções e regressões: **146 testes em 23 arquivos aprovados**, Linux / Node 24.19.0.
A publicação desta revisão em branch e pull request foi autorizada pelo usuário
após a entrega local. A versão continua 0.7.0; não há nova tag ou release, nem
homologação do instalador para usuário final.

## Arquitetura observada

TypeScript ESM, SDK MCP, stdio e Express Streamable HTTP. Recursos por sessão:
jobs, PTYs, watchers, ambiente e confirmações. Autenticação Bearer e plano admin
loopback separado. Política JSON, arquivos no workspace, audit JSONL. Não há banco,
contas de usuário/tenant ou frontend web; o painel existente é PowerShell/WinForms.
Execução autorizada tem privilégios do usuário do processo, não isolamento de SO.

## Correções verificadas no código e em testes locais

- Removidos bytes NUL/controles reais de `exec.ts` e `docker.ts`; scanner UTF-8 de fontes e CI.
- `run_command` usa executor assíncrono gerenciado: shell:false, timeout/cancelamento,
  truncamento por bytes UTF-8, saída combinada limitada e cleanup ao fechar sessão.
  O helper síncrono permanece apenas para compatibilidade/testes, fora desse endpoint.
- Jobs ativos/retidos com cotas local/global, TTL, stdin limitado e destroy idempotente.
  PIDs de jobs concluídos não são considerados propriedade da sessão, nem cancelados novamente.
- PTYs e watchers com cotas; PTYs encerrados expiram; handlers de erro de watchers.
  Requests HTTP concorrentes por sessão limitados e tabela de sessões sem prototype herdado.
- Regex e busca por nome/conteúdo rodam em worker cancelável com timeout. Fechar a
  sessão aborta workers. Busca limitada por entradas, bytes, linhas, resultados e trecho.
- Documentos processados em worker com heap V8 limitado, prazo e entrada máxima 2 MB.
  ZIP central e dados realmente inflados são limitados a 16 MB; rejeita ZIP64 e arquivos
  criptografados. PDF limitado a 200 páginas, texto a 200 mil caracteres; planilhas a
  dimensões/células limitadas e só a página é convertida para array de resposta.
- Limites agregados para múltiplos arquivos, projetos, DOCX e planilhas; saída escrita
  validada antes de gravar. Sessão fechada impede conclusão de escrita assíncrona.
- Falha adicional: aprovação de projetos/documentos aceitava trocar conteúdo.
  Corrigida vinculando todos os argumentos. Comandos incluem ambiente da sessão no
  fingerprint. Testes MCP tentam trocar conteúdo e comprovam ausência de escrita.
- Falha adicional: download fazia novo DNS após validação e retirava timeout antes
  de ler o corpo. Agora fixa o IP validado e mantém prazo/cancelamento até o fim;
  também bloqueia IPv4 mapeado hexadecimal e IPv6 não global.
- Falha adicional: política mutável compartilhada entre sessões. Cada sessão agora
  recebe cópia própria. Renomear arquivo valida a extensão de destino. Edição verifica
  alteração concorrente antes de sobrescrever e revalida caminho após processamento.
- Flags inválidas falham; token exige formato de 32 bytes; limites e policy.json
  passam por validação runtime. Testes adaptados ao novo contrato, sem remover casos.
- Token rotation/revoke persistem atomicamente, fazem flush, leitura de verificação
  e retornam estado persisted/memory-only/failed. Linhas duplicadas de token são removidas.
  Operações síncronas serializam rotações dentro do processo; não há lock multiprocesso.
- Audit aplica hashing/tamanho de strings e estruturas antes de serializar, incluindo
  erros, paths, queries, stdin e URLs. Permissões privadas, rotação e retenção. Modo
  audit_required registra intenção antes das mutações cobertas por gate e recursos.
- `human_local`: decisão pelo admin autenticado, sem segredo de aprovação copiado ao
  modelo; preview exato no painel local Windows. Testado store/fluxo lógico, não a GUI.
- `npm run doctor`: handshake autenticado, tools/list e encerramento da sessão.
- Atualizados Vitest/Vite para remover cinco advisories de desenvolvimento, sem force
  nem legacy-peer-deps. Audit completo e produção retornaram zero vulnerabilidades.

## Instalador e CI: implementados, ainda sem homologação externa

- cloudflared 2025.8.1 fixado, SHA256 oficial, assinatura válida e editor Cloudflare
  exigidos também no executável existente; removido fallback latest.
- Credencial do túnel em arquivo privado `--token-file`, não no argv.
- Parada verifica PID, executável, command line e criação. Estado antigo/incompatível
  não autoriza kill. Validação reduz reutilização de PID, sem atomicidade garantida pelo kernel.
- ACL aplicada antes da gravação de credenciais; `.env`, admin.secret e audit privados.
- Painel mostra persistência na rotação/revogação, respeita adminPort explícito e tem botão de aprovação.
- Launcher verifica saúde antes de declarar ativo e preserva estado de instância identificada.
- CI matriz Ubuntu/Windows/macOS com Node 22; teste PowerShell de parsing, ACL,
  configuração idempotente e recusa de identidade divergente. Não executado remotamente.
- Release inclui SIGNING-STATUS; sem certificado, instalador permanece não assinado.

## Evidências finais

| Verificação | Resultado local |
|---|---|
| npm ci | exit 0; 319 pacotes instalados |
| npm run build | exit 0 |
| npm run typecheck | exit 0 |
| npm test | exit 0; 146/146, 23 arquivos, nenhum skip |
| npm audit --omit=dev | exit 0; zero vulnerabilidades |
| npm audit | exit 0; zero vulnerabilidades |
| npm sbom --sbom-format cyclonedx --omit=dev | exit 0; SBOM em evidence/sbom.json |
| npm run check:source | exit 0; UTF-8 e ausência de controles indevidos |
| git diff --check | exit 0 |
| Doctor HTTP real | exit 0; autenticação, MCP e 23 ferramentas no safe |

Logs e JSON completos estão em `evidence/`. Uma execução intermediária de testes
foi invalidada pela reinstalação simultânea de node_modules; o conflito de execução
foi removido e a instalação e suíte final foram executadas em sequência. Os resultados
finais acima referem-se às rodadas posteriores, sem ocultar a falha intermediária.

## Riscos e trabalho restante — meta ampla NÃO encerrada

### BLOCKED_BY_EXTERNAL_DEPENDENCY

- Windows/macOS reais: instalador limpo, upgrade, logon, GUI, ACL, taskkill, PTY nativo,
  rollback e desinstalação. O ambiente disponível é Linux e não tem PowerShell.
- Cloudflare: execução real do túnel, assinatura Authenticode do binário oficial na
  máquina alvo e configuração de domínio/conta. Checksum verificado na fonte oficial;
  não equivale à validação do binário no Windows. Sem assinatura válida, fail-closed.
- Certificado de assinatura e homologação do EXE/scripts não disponíveis.
- Contas ChatGPT/Claude e conectores reais: não testados; Bearer manual pode não estar
  disponível em todos os clientes. HTTP MCP saudável não prova integração comercial.
- CI remota: resultados devem ser consultados nos checks do pull request; as evidências abaixo registram a validação local anterior à publicação.

### NOT_IMPLEMENTED — engenharia de produto, não bloqueio de credencial

- Device pairing com credenciais individuais, dashboard de dispositivos e revogação por dispositivo.
- Preview visual rico e edição avançada de PDF/DOCX/XLSX; hoje há leitura/criação básica.
- Análise de dados dedicada em memória com API e limites próprios.
- Atualização automática verificável e rollback transacional do instalador.
- Aprovação humana local em GUI para Linux/macOS; human_local atual requer HTTP e painel Windows.
- Teste completo e automatizado do ciclo de instalação/atualização/rollback/desinstalação em VM limpa.

### Limitações remanescentes do modelo de segurança

- Guardrails não são sandbox. Node/Python/Docker/scripts autorizados podem ler arquivos,
  rede, ambiente e segredos do usuário do processo. human_local não protege contra
  um programa previamente autorizado com acesso ao segredo administrativo local.
- Heap de worker não é teto de memória nativa; usar usuário dedicado, cgroups/VM ou
  Docker rootless para isolamento real. ExcelJS carrega arquivo inteiro, limitado e fora do event loop.
- Operações de filesystem ainda têm janelas TOCTOU contra outro processo local que
  troca symlinks. Não há isolamento forte entre agentes com shell arbitrário no mesmo SO.
- Downloads agora conectam ao IP público validado, preservando Host/SNI, com validação
  por redirect e prazo também no corpo. Rotas públicas reais/TLS ainda precisam de
  validação no ambiente alvo; as regressões locais verificam rejeição de endereços e abort.
- Escritas de projetos não são transação multiarquivo: falha de disco pode deixar projeto parcial.
- Auditoria não tem hash chain e não é inviolável para o dono do processo. Falha após
  efeito colateral pode impedir registrar o resultado; intenção anterior não é rollback.
- PTY é opcional; fallback informado ao usuário é run_job. Ainda é necessário validar
  encerramento de toda a árvore em PTYs nas três plataformas.
- Tokens manuais de formato válido não têm entropia comprovável. Gerar aleatoriamente.
  Variável BRIDGE_TOKEN herdada pode sobrepor `.env` no boot e requer operação consistente.
- Launcher não implementa recuperação transacional de todas as falhas após iniciar
  Node/túnel; não deve ser anunciado como instalação de um clique homologada.

## Instalação e clientes

Use a seção “Instalação e diagnóstico desta revisão” do README: Node compatível,
`npm ci`, build/test, `.env` próprio, token aleatório, safe, HTTP e `npm run doctor`.
Para MCP local, use stdio. Para remoto, exponha somente a porta MCP por HTTPS,
nunca a porta admin, e confirme o mecanismo de autenticação suportado pelo cliente.
Não copie secrets em chats ou commits. Nenhum deployment foi realizado nesta auditoria.

## Fontes externas verificadas

- https://github.com/cloudflare/cloudflared/releases/tag/2025.8.1 — digest do binário Windows amd64.
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/ — token-file a partir de 2025.4.0.
- https://github.com/wonderwhy-er/DesktopCommanderMCP — Remote AI Control e catálogo atual; removida comparação “só stdio”.
