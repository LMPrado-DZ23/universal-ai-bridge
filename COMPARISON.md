# Comparação de capacidades — 21/09/2026

Escopo: Universal AI Bridge desta PR versus catálogo público do Desktop Commander.
A coluna Desktop Commander descreve o README oficial consultado nesta data; **não
foi testado** neste ambiente. Ausência de evidência não significa ausência do recurso.
Não se afirma superioridade nem equivalência de segurança. Remote MCP/App Beta e
servidor local do Desktop Commander são superfícies distintas.

| Capacidade | Universal AI Bridge | Desktop Commander: documentação, sem teste independente |
|---|---|---|
| Arquivos | Implementado: leitura, escrita, edição, metadados | Implementado: operações de filesystem documentadas |
| Busca | Implementado: worker, regex, limites | Implementado: busca com ripgrep e documentos |
| Terminal | Implementado: executáveis estruturados, batch restrito | Implementado: comandos e streaming |
| Jobs | Implementado: status, stdin, cursores, cancelamento | Implementado: processos longos/interativos |
| PTY | Parcial: dependência opcional; árvore exige homologação adicional | Não testado: terminal interativo documentado, contrato PTY não verificado |
| Documentos | Parcial: ler/criar PDF, DOCX, XLSX/CSV; sem editor avançado | Implementado: leitura/criação/edição documentadas |
| Preview | Não implementado: sem preview visual rico | Implementado: preview e editor Markdown documentados |
| Docker | Parcial: controle opt-in do Docker do host; não é sandbox | Implementado: instalação Docker documentada; isolamento depende dos mounts |
| Sessões | Implementado: recursos próprios, TTL e descarte | Implementado: sessões de processos documentadas |
| Histórico | Parcial: audit, sem ferramenta de histórico navegável | Implementado: get_recent_tool_calls documentado |
| Auditoria | Implementado: hashes/metadados, rotação; não inviolável | Implementado: histórico/logs locais e rotação documentados |
| Aprovação | Parcial: quatro modos; GUI human_local Windows não homologada | Não testado: fluxo equivalente não verificado |
| Token rotation | Implementado: admin local, persistência e revogação global | Não testado: sem equivalência verificada |
| Pairing | Não implementado | Não testado: serviço Remote Device documentado, fluxo não validado |
| Dashboard | Não implementado: apenas painel local Windows | Parcial: App Beta e Remote MCP documentados, dashboard equivalente não testado |
| Instalação | Parcial: código-fonte e preview Windows; falta homologação limpa | Implementado: npx, scripts, Docker e App documentados |
| Update/rollback | Parcial: reinstalação preserva config; sem auto-update/rollback transacional | Parcial: auto-update documentado; rollback não testado |
| Multiplataforma | Parcial: matriz Node 22 nos três SOs; instalador/GUI só Windows | Implementado: instruções Windows/macOS/Linux; sem execução independente |

Fonte primária: https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/README.md
Evidências do Bridge: testes no repositório e checks da PR #1.
