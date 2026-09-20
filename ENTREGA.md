# Entrega para revisão — Universal AI Bridge

Base: v0.7.0 / 5c3b0504b483baa825449c60475226f3b5adbc76.

Este pacote contém o código revisado, testes, CI, scripts e evidências. Não é uma
release homologada. Publicação em branch e pull request autorizada pelo usuário;
sem nova tag ou release.

1. Comece por AUDIT.md: correções, resultados, riscos e trabalho que falta.
2. Consulte README.md para instalação manual, configuração e npm run doctor.
3. Veja evidence/changed-files.txt para os arquivos alterados.
4. evidence/tests.log contém o resultado da suíte; audit-prod.json e audit-all.json
   contêm auditorias de dependências; sbom.json contém o inventário CycloneDX.
5. O patch da revisão fica em review.patch na raiz do ZIP, fora desta pasta.

Para revisar em checkout próprio da base, use uma branch nova e git apply --check
antes de git apply no patch. O patch inclui correções binárias dos NUL originais.
Não aplique cegamente sobre branches posteriores: compare e resolva diferenças.

Não foram incluídos .env, tokens reais, node_modules, audit de execução ou instalador EXE.
As configurações de teste usam tokens artificiais, sem acesso externo.

BLOCKED_BY_EXTERNAL_DEPENDENCY: validação Windows/macOS, certificado, Cloudflare,
contas/conectores reais de ChatGPT e Claude. Há também engenharia NOT_IMPLEMENTED
listada em AUDIT.md; a meta ampla do anexo continua aberta.
