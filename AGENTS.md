# Orientações para agentes no Feito

## Projeto

O Feito é um aplicativo web de tarefas pessoais para auto-hospedagem. A interface em português do Brasil reúne Caixa de entrada, Hoje, Em breve, projetos em Lista e Painel, subtarefas, etiquetas, busca, recorrência e importação e exportação. O cadastro é fechado e cada conta tem seu próprio tenant no banco.

O monorepo reúne o web em [apps/web](apps/web) e o desktop Tauri em [apps/desktop](apps/desktop). O desktop funciona com um espaço local ou sincroniza com uma instalação Feito por HTTPS. Os pacotes [@feito/core](packages/core) e [@feito/ui](packages/ui) são a fonte comum. Leia o [AGENTS.md do desktop](apps/desktop/AGENTS.md) ao trabalhar em Tauri ou nos espaços.

Use **Node.js 24**, **pnpm 10** e **PostgreSQL 18**. O app usa Next.js App Router, React e TypeScript. A API usa Zod, Better Auth e Drizzle, com criptografia de envelope no servidor. Os testes usam Vitest e Playwright. Consulte `package.json`, `.node-version` e `pnpm-lock.yaml` para as versões adotadas.

## Onde trabalhar

| Área | Caminho |
| --- | --- |
| Telas e navegação | [Rotas web](apps/web/src/app), [telas compartilhadas](packages/ui/src/screens), [entrada desktop](apps/desktop/src/main.tsx) |
| Estilos, componentes e animação | [globals.css](packages/ui/src/globals.css), [ui.tsx](packages/ui/src/components/ui.tsx), [motion.tsx](packages/ui/src/components/motion.tsx) |
| Cliente HTTP, cache e mutações otimistas | [Cliente compartilhado](packages/ui/src/client), [tipos compartilhados](packages/core/src/types.ts) |
| Agenda, recorrência e hierarquia | [Domínio](packages/core/src/domain), [validação](packages/core/src/validation), [serviços de produto](packages/core/src/product) |
| Rotas HTTP, sessão, criptografia e persistência web | [API](apps/web/src/app/api), [servidor](apps/web/src/server), [migrações](apps/web/drizzle) |
| Testes, CI e ferramentas administrativas | [Testes web](apps/web/tests), [CI web](.github/workflows/web.yml), [CI desktop](.github/workflows/desktop.yml), [scripts](scripts) |

- Antes de editar, siga o fluxo desde a tela ou rota até a implementação e os testes. Reaproveite os componentes, regras e contratos existentes. Quando a documentação histórica divergir da implementação, confirme o comportamento atual no código e nos testes.
- Mantenha a mudança no escopo pedido e preserve alterações já presentes no checkout. Prefira código simples, tipos precisos e nomes claros. Justifique dependências novas com uma necessidade concreta.
- Preserve compatibilidade com consumidores da API e dados já gravados. Quando alterar um contrato, ajuste os tipos, os chamadores, os testes e a documentação correspondente.
- Ao alterar módulos compartilhados, confira os adaptadores e testes dos dois apps. As dependências seguem de apps/web e apps/desktop para @feito/ui e @feito/core, e de @feito/ui para @feito/core. A navegação, persistência e geração de IDs entram pelos adaptadores. Confirme as rotas `/api/v1/desktop-sync` e `/api/v1/product-events` e as migrações ao validar uma instalação integrada.

## Frontend

- Reutilize os tokens de cores, tipografia, foco e movimento de `globals.css`. Use os componentes comuns de `ui.tsx` e os mecanismos de presença e reordenação de `motion.tsx` nas interações que aparecem, somem ou mudam de posição.
- Para mudanças visuais ou de interação, confira a tela em um navegador nas larguras de desktop e celular. Considere os temas claro e escuro, navegação por teclado e por toque e movimento reduzido. Preserve o conteúdo e a ordem de foco em transições e reordenações.
- Use controles semânticos com nomes acessíveis e foco visível. Preserve o foco inicial e o retorno do foco em diálogos e menus. Mantenha alternativas por teclado ou menu para ações de arraste.
- Represente estados relevantes de carregamento, vazio, erro e nova tentativa. Durante uma atualização, preserve dados e campos em edição que ainda sejam válidos. Trate respostas fora de ordem, mudanças de rota e ações simultâneas.
- Use `packages/ui/src/client/api.ts` e `packages/ui/src/client/store.ts` para conversar com a API e atualizar as leituras. Mutações de tarefa passam por `task-mutations.ts` e `task-projections.ts`. Aplique a previsão local, envie a gravação, reconcilie pela resposta oficial e reverta apenas a ação que falhou. Preserve a sequência de revisões quando houver dependência entre ações.
- Ao alterar tarefas, confira as projeções realmente afetadas, inclusive subtarefas, ordem, contagens, etiquetas, busca e agenda. Prefira aplicar a resposta canônica a disparar uma invalidação global. A previsão do navegador complementa os controles do servidor. Grave cada ação pela API e mantenha IDs temporários, rascunhos e dados do cache na memória do navegador.
- Use o vocabulário das telas existentes e os helpers de datas. Trate vencimento como data civil `YYYY-MM-DD`, horário como hora local e conclusão como instante. Use o `referenceDate` e o fuso da conta quando a regra depender de Hoje, atrasos ou recorrência. [Movimento e interação](docs/04-motion-and-interaction.md) · [Marca](docs/05-brand.md)

## API, dados e segurança

- Mantenha os Route Handlers finos. Valide corpo, parâmetros e query com os esquemas Zod, use os helpers de `apps/web/src/server/http/` para autenticação, origem e erros, e concentre as regras de negócio nos serviços. Mantenha módulos sensíveis com `server-only`.
- Em rotas privadas, derive o tenant da sessão validada. Use a transação criada por `withTenant` nas consultas do domínio e preserve o isolamento por RLS. Recursos de outro tenant devem se comportar como ausentes. Em compartilhamentos públicos, use o fluxo por token e exponha somente os campos permitidos pelo DTO público.
- Preserve a validação de `Origin` nas rotas privadas que usam métodos de escrita, as restrições de senha provisória, os cookies seguros e `Cache-Control: private, no-store` nas respostas da API. Use DTOs explícitos e mantenha texto de busca e outros dados pessoais fora da URL e dos logs.
- Faça mudanças relacionadas na mesma transação. Verifique a `revision` das entidades quando o contrato exigir e avance `productRevision` na transação de qualquer gravação que altere as projeções do produto. Considere concorrência, rollback e repetição de requisições. Preserve a idempotência dos fluxos que já a oferecem, como conclusão recorrente e importação.
- Preserve criptografia de envelope, isolamento das chaves por conta, verificação de integridade dos payloads e orçamento de uso das chaves. Use as funções existentes de leitura, escrita e rotação. Em mudanças de esquema ou privilégios, use `pnpm db:generate` para acrescentar uma migração em `apps/web/drizzle/`. Valide tanto a instalação nova quanto a atualização quando aplicável, com as roles reais de execução e permissões mínimas.
- Mantenha segredos e dados pessoais fora do Git, do bundle, dos logs e das métricas. Guarde arquivos de ambiente e chaves em diretórios privados fora do checkout. Separe as credenciais de domínio, autenticação, migração e administração. [Arquitetura e isolamento](docs/01-architecture-and-stack.md) · [Contrato HTTP](docs/02-backend-endpoints.md)

## Leituras e desempenho

- Comece pelas consultas delimitadas, pelos DTOs necessários à tela e pela paginação existente. Meça leituras frias e quentes antes de ampliar o cache ou adicionar infraestrutura. Considere volume de registros, consultas, decifragem e memória retida.
- O cache de produto é em RAM por processo. Guarda sob demanda os resumos de navegação, projetos ativos, projetos arquivados e etiquetas. Ele tem expiração de 12 horas e limites por entrada e por processo. Preserve a autorização antes da leitura, a separação por tenant e projeção e a exclusão de descrições de tarefas, sessões e chaves desse cache.
- Leituras cacheáveis verificam `productRevision` no PostgreSQL primário. A revisão e a reconstrução da projeção usam o mesmo snapshot transacional. A navegação também respeita a virada do dia no fuso da conta. Ao mudar o cache, teste expiração, isolamento, commits concorrentes e leituras feitas por instâncias diferentes. [Cache e medições](docs/03-operations.md#cache-interno-de-leituras-do-produto)

## Desenvolvimento e operação

- Na raiz, instale dependências com `pnpm install --frozen-lockfile`. Use `pnpm dev:desktop` para o desktop. Para desenvolvimento local, use `compose.dev.yaml` ou `pnpm dev` com HTTPS e `FEITO_ORIGIN` igual à origem acessada pelo navegador. `scripts/new-env.sh` gera um arquivo privado de ambiente.
- A produção usa a saída standalone do Next.js. `compose.prod.yaml` usa Caddy e PostgreSQL interno. `compose.prod.tunnel.yaml` usa PostgreSQL externo com TLS verificado, e o `cloudflared` encaminha para `http://app:3000` na rede do Compose. As migrações rodam antes do app. Use `GET /api/health` para verificar a saúde da instalação.
- Use um banco descartável e credenciais próprias para desenvolvimento e testes. O `compose.yaml` sobe apenas o PostgreSQL. Consulte a documentação de backup, restauração e rotação antes de alterações que afetem instalações existentes. [Instalação](apps/web/README.md) · [Operação e manutenção](docs/03-operations.md)

## CI e distribuição

- O [workflow web](.github/workflows/web.yml) verifica tipos, build, Compose, testes unitários e de integração com PostgreSQL 18, e Playwright em HTTPS. Publica as imagens web e de ferramentas no GHCR após as verificações. Em pushes para `main` e `dev`, usa as tags de imagem `latest` e `dev`, respectivamente. Em pushes de tags `vX.Y.Z`, publica as imagens com a versão `X.Y.Z`.
- O [workflow desktop](.github/workflows/desktop.yml) verifica TypeScript e Rust em seis alvos. Pushes de tags `vX.Y.Z` e execuções manuais geram os 11 instaladores e os guardam nos artefatos da execução. Pushes dessas tags também publicam os instaladores no GitHub Releases após a matriz passar. [Matriz de instaladores](apps/desktop/README.md#ci-e-releases)
- Os dois workflows verificam pull requests e pushes para `main` e `dev`, inclusive alterações nos pacotes compartilhados. Para uma release oficial, ambos usam a mesma tag, que deve corresponder à versão em `apps/desktop/src-tauri/tauri.conf.json`. [Instruções de release](docs/03-operations.md#releases)

## Testes

- Ao corrigir um bug, crie um teste de regressão na camada que reproduz o comportamento incorreto e confirme a correção.
- Para mudanças relevantes, execute os testes diretamente ligados ao comportamento alterado antes de concluir. Inclua as outras camadas quando forem afetadas. Se faltar cobertura adequada, adicione um teste quando possível.
- Use dados sintéticos e o PostgreSQL descartável de integração. Em testes de concorrência, controle a ordem das operações. No Playwright, prefira seletores semânticos e asserções sobre o estado observável a esperas fixas.
- Na entrega, informe quais verificações passaram e quais ficaram pendentes, com o motivo. Para mudanças só de documentação, revise o diff, os links e a correspondência com o código e as ferramentas do projeto.

| Comando | Quando usar |
| --- | --- |
| `pnpm test` | Testes TypeScript dos dois apps. Use `pnpm --filter @feito/web test` ou `pnpm --filter @feito/desktop test` para rodar apenas um. |
| `pnpm test:integration` | Contratos HTTP, isolamento, persistência, concorrência e migrações. Use PostgreSQL 18 descartável e aplique `pnpm db:migrate` antes. |
| `pnpm test:e2e` | Fluxos do web em Chromium, nos perfis de navegador desktop e celular, com build e servidor HTTPS de teste. [Configuração do Playwright](apps/web/tests/e2e/README.md) |
| `pnpm test:coverage` | Testes unitários e de integração com cobertura, como no CI. |
| `pnpm typecheck` e `pnpm build` | Tipos e builds dos dois frontends, incluindo rotas geradas e limites entre cliente e servidor. |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Testes do núcleo nativo do desktop, executados a partir da raiz. |
