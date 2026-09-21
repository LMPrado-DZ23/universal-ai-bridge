# Auditoria Universal AI Bridge — PR #1

Escopo: branch `codex/hardening-v0.7.0` contra `main`, versão mantida em 0.7.0.
Sem merge, tag ou release nesta execução. Esta revisão não homologa o produto para
uso final nem conclui o roadmap de funcionalidades ausentes.

## Baseline e reprodução

Base v0.7.0: `5c3b0504b483baa825449c60475226f3b5adbc76` (82 blobs conferidos em
`evidence/source-provenance.json`). A primeira revisão publicada foi
`94bfc5b1e495d383b6693c5272241ed044023e14`.

- Baseline local: npm ci, check:source, build, typecheck, 146 testes e auditorias
  completas/produção passaram no Linux Node 24.19.0.
- CI original: Ubuntu/macOS passaram; Windows falhou em npm com status null.
  Run: https://github.com/LMPrado-DZ23/universal-ai-bridge/actions/runs/35545939884
- Regressões antes da correção: `npx vitest run tests/execution-regression.test.ts`
  reproduziu 4 falhas: seleção do shim POSIX, status de spawn sobrescrito,
  executável ausente sem resultado determinístico e UTF-8 fragmentado corrompido.
- `tests/persistence-regression.test.ts` reproduziu restauração do token herdado
  após revogação e fallback indevido quando o arquivo explícito não existia.
- A primeira nova rodada remota confirmou npm/npx reais no Windows corrigidos,
  mas detectou comparação case-sensitive no teste do caminho npm.CMD. O teste foi
  ajustado ao contrato de caminhos, mantendo a asserção contra o shim sem extensão.
- Windows confirmou 206 testes, incluindo npm/npx, PTY, árvore de processos e
  persistência privada. A DACL usa APIs .NET em Windows PowerShell, evitando
  dependência de módulos herdados do PowerShell 7. O teste verifica a ACL real.
- A regressão de upgrade detectou coerção de `$null` para caminho vazio em
  File.Replace; corrigida com NullString para preservar substituição atômica.
- PowerShell 5.1 revelou erro de parsing por UTF-8 sem BOM; scripts com texto
  não ASCII agora têm BOM e check:source impede a regressão de codificação.

## Arquitetura e correções

TypeScript ESM, MCP stdio/HTTP, Express, política JSON e recursos por sessão.
Sem banco, contas multitenant ou frontend web. Painel local Windows em WinForms.

- Windows resolve apenas formatos suportados; não seleciona o shim POSIX npm.
  Batch usa cmd.exe com switches separados, aspas externas e argumentos restritos.
  Executáveis nativos continuam shell:false. Parser/allowlist têm regressões.
- Jobs assíncronos preservam status -1 de spawn e timedOut=false; StringDecoder
  preserva UTF-8 entre chunks. PID deixa de ser propriedade viva no evento exit.
  Timeout/cancelamento testam árvore ativa sem encerrar processo externo.
- Cotas por sessão e globais para jobs/retidos, PTYs, watchers, confirmações,
  saída, workers e requests; rate limiter limita buckets e descarta timer no close.
  Recursos e decisões são descartados com a sessão. Cursores são offsets UTF-16,
  enquanto limites de retenção são calculados em bytes.
- PDF é processado em subprocesso com timeout/cancelamento, mesma cota global e
  heap limitado; falha nativa fica fora do servidor. Demais documentos/regex usam
  workers limitados; ZIP valida diretório, tamanho real,
  flags locais e ZIP64; documentos têm teto antes de parsing.
- Escrita em temporário, fsync e rename de arquivos/documentos/downloads, com
  revalidação no commit. create_project retorna caminhos concluídos em falha
  parcial real. Removida validação duplicada no gerador de planilha.
- Aprovação vinculada a conteúdo, TTL, uso único, recusa e decisão local. Segunda
  aprovação local é rejeitada. Console local mostra metadados em vez do conteúdo.
- Token persistido, inclusive vazio, prevalece sobre token herdado. Arquivo
  explícito ausente/ilegível falha fechado. Rotações síncronas são serializadas
  pelo event loop; não se oferece coordenação entre múltiplos processos.
- Arquivos privados POSIX 0600; Windows substitui a DACL por regra do usuário.
  Erro de ACL impede escrita do segredo. Logs HTTP/erros não refletem corpos.
- Doctor valida autenticação, initialize, tools/list, DELETE e recusa HTTP remoto;
  smoke verifica zero sessões restantes e encerra o processo.
- Instalador preserva configuração/revogação em upgrade, usa escrita privada
  atômica, valida portas e identidade de PID e limpa tentativas de inicialização.
  Inno propaga erro das etapas. Token Cloudflare permanece em arquivo privado.
- Node MSI 22.23.2 com hash fixado e editor OpenJS Foundation; cloudflared 2025.8.1
  com hash/editor fixados. Binário inválido é recusado, sem fallback latest.
- CI sem filtros de paths incompletos; matriz Node 22 nos três SOs, auditorias,
  PowerShell 7/5.1, SBOM e compilação do instalador. Preview unsigned separado;
  produção exige certificado e Authenticode válido. Senha de assinatura fora do argv.
- Removidos resíduos de .gitignore e logs/SBOM gerados da árvore. Relatórios grandes
  ficam em artifacts. Matriz comparativa factual em COMPARISON.md.

## Validação

Resultados e referências de CI são registrados em `evidence/results.json`.
O código em `92cc4fec71ab4f89443538f316911118c49b3eed` passou toda a matriz
Linux/Windows/macOS (206 testes por SO), PowerShell 7/5.1 e build Inno Setup.
O preview foi baixado: SHA-256 do ZIP e do executável conferem; SBOM CycloneDX
contém 263 componentes e Authenticode informa NotSigned. Os checks do commit
final de documentação também precisam passar antes do aceite do PR.
Veredito do escopo: correções aptas à revisão/merge após esses checks; release
de distribuição não homologada pelos bloqueios externos descritos abaixo.
O aceite local em checkout limpo aprovou 206 testes em 25 arquivos. Os checks da PR
são a autoridade para o SHA remoto; falha intermediária não equivale a aprovação.

Comandos de aceite: npm ci; npm run check:source; npm run build; npm run typecheck;
npm test -- --reporter=verbose; npm audit --omit=dev; npm audit --audit-level=moderate;
node scripts/smoke-doctor.mjs; git diff --check; git fsck --no-reflogs --full.
O smoke executa o mesmo script de `npm run doctor` contra servidor real temporário.

## Regressão adicional de PDF no Windows

A repetição da suíte no commit de evidências perdeu o processo durante read_pdf
(ECONNRESET seguido de ECONNREFUSED), apesar da matriz principal aprovada.
O relato upstream https://github.com/mozilla/pdf.js/issues/21934 descreve falha
nativa compatível ao importar PDF.js 5.x em worker_threads no Windows. Sem dump,
a causa nativa exata permanece inferida. PDF passou a usar processo filho e IPC,
sem segredos herdados, com encerramento aguardado antes de liberar a cota.
A regressão executa cinco leituras reais consecutivas, cancelamento e deadline.
As evidências anteriores continuam identificadas pelo SHA; os checks mais recentes
do PR são necessários para validar este ajuste adicional.

## Riscos residuais e limites

- Não é sandbox. Node/Python/Docker/batch autorizados usam privilégios do processo;
  podem acessar rede, arquivos e segredos desse usuário. Docker do host pode
  equivaler a root. Use usuário dedicado, VM/cgroups ou Docker rootless.
- Checagens de paths/identidade têm TOCTOU frente a processos locais adversários.
  Processo que se desanexe deliberadamente pode escapar da árvore gerenciada;
  não há Windows Job Object/cgroup como fronteira de contenção.
- Heap V8 de worker não limita toda memória nativa. ZIP/documentos e saída têm
  limites de aplicação, não garantia de memória/CPU do sistema operacional.
- Auditoria não é inviolável para o dono do processo; registro posterior pode
  falhar após efeito colateral. create_project não é transação multiarquivo.
- Falha de persistência retorna failed e exige intervenção antes de reiniciar.
  Token válido em formato não prova entropia; gere com RNG criptográfico.
- HTTP/MCP real não prova integração com contas comerciais ChatGPT/Claude.
  HTTPS, token, Origin allowlist e cliente compatível são necessários.
- Não implementados: pairing/revogação por dispositivo, dashboard hospedado,
  preview rico, edição avançada de documentos, auto-update e rollback transacional.
- human_local possui painel Windows; GUI Linux/macOS não implementada.

## BLOCKED_BY_EXTERNAL_DEPENDENCY — homologação de distribuição

Certificado de code signing, conta/domínio Cloudflare e clientes comerciais não
foram disponibilizados. Não houve execução de GUI interativa nem ciclo completo
de instalação/upgrade/rollback/desinstalação em VM limpa. Build de preview e testes
PowerShell não substituem essa homologação. Não publicar release até validação
Windows e decisão explícita do usuário. O gate unsigned é testado negativamente;
a assinatura positiva depende de certificado real.

Fontes: https://nodejs.org/api/child_process.html;
https://nodejs.org/dist/v22.23.2/SHASUMS256.txt;
https://github.com/cloudflare/cloudflared/releases/tag/2025.8.1;
https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/README.md.
