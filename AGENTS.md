# Orientações para agentes

## Testes

- Ao corrigir um bug, crie um teste de regressão que reproduza o comportamento incorreto e confirme a correção. Escolha a camada adequada ao bug: unitária, integração ou ponta a ponta.
- Ao fazer uma mudança relevante, identifique e execute os testes mais diretamente relacionados ao comportamento alterado antes de concluir o trabalho. Inclua testes de outras camadas quando a mudança afetar essas camadas.
- Se não houver teste adequado, acrescente um quando for possível. Se não for possível executar os testes relevantes, explique o motivo e informe claramente quais testes ficaram pendentes; não os apresente como verificados.
- Use os scripts do projeto: `pnpm test` para testes unitários, `pnpm test:integration` para integração, `pnpm test:e2e` para ponta a ponta e `pnpm test:coverage` para unitários e integração com cobertura.
