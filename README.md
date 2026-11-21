# Feito

Feito é um app de tarefas pessoais que você hospeda na sua máquina ou no seu servidor. Capture tarefas na Caixa de entrada, planeje o que fazer em Hoje e Em breve e organize seus projetos em listas ou painéis. O app oferece subtarefas, etiquetas, prioridades e recorrência, além de importação do Todoist e exportação de dados. Os dados de tarefas e projetos são armazenados cifrados.

![Feito desktop no tema escuro, na visão Hoje, com tarefas do dia, atrasos, horários e prioridades](docs/screenshots/hoje.png)

## Como usar

- **[Web](apps/web/README.md)**: instale no seu computador ou servidor com Docker Compose e acesse pelo navegador, inclusive no celular.
- **[Desktop](apps/desktop/README.md)**: baixe o instalador para macOS, Windows ou Linux. Funciona sozinho, com as tarefas neste computador, ou sincroniza com uma instalação web.

## Desenvolvimento

Use Node.js 24 e pnpm 10. Para o desktop, instale também Rust estável e os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

`pnpm typecheck`, `pnpm test` e `pnpm build` verificam os dois apps. O web em modo de desenvolvimento, os testes e as releases estão em [Operação e manutenção](docs/03-operations.md).

## Documentação

- [Operação e manutenção](docs/03-operations.md)
- [Arquitetura](docs/01-architecture-and-stack.md)
- [API](docs/02-backend-endpoints.md)
- [Movimento e interação](docs/04-motion-and-interaction.md)
- [Marca](docs/05-brand.md)
