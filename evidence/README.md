# Evidências versionadas

`source-provenance.json`: hashes dos 82 arquivos da base v0.7.0 obtida pelo conector.
`results.json`: resumo pequeno e intencional; não contém tokens ou conteúdo de usuário.

Logs completos, relatórios JSON de testes e SBOM são gerados pelo GitHub Actions
como artifacts (`validation-<SO>` e `preview-unsigned-assets`), não versionados.
Os antigos logs/SBOM da entrega local foram removidos da árvore; continuam no
histórico como registro daquela revisão. Não foram encontrados segredos reais que
justificassem reescrever o histórico compartilhado.
