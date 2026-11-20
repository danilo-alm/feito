# Migração para o monorepo

O histórico do Feito Web é a base da integração. O estado de entrada era o commit web `b04b554` e o commit desktop `056184e`, incluindo as alterações locais rastreadas e os arquivos novos de ambos. Os arquivos migrados seguem a licença PolyForm Noncommercial 1.0.0 da raiz. A cópia anterior do desktop em `vendor/feito` vinha da revisão web `646f567`.

## Destino do código

| Origem | Destino no workspace |
| --- | --- |
| Next.js, API, PostgreSQL, migrações e testes web | `apps/web` |
| Tauri, SQLite, IPC, gerenciamento de espaços e testes desktop | `apps/desktop` |
| Tipos, contratos, validação e regras de produto | `packages/core` |
| Componentes, telas comuns, estilos, cache e cliente HTTP | `packages/ui` |
| Dockerfile, Compose, scripts de operação e workflows | Raiz do repositório |

Os dois apps declaram dependências locais do workspace. Regras de produto recebem o adaptador de persistência correspondente. A navegação dos componentes compartilhados recebe o adaptador Next.js no web e o adaptador Vite no desktop. O bundle Tauri inclui o código compartilhado que usa e os próprios adaptadores.

## Trabalho local conciliado

- O redesign de Ajustes do Claude foi trazido das duas árvores locais. Os grupos e estilos comuns ficam em `packages/ui`. A tela web mantém Conta, Dados, importação do Todoist e a âncora de projetos arquivados. A tela desktop mantém o gerenciamento de espaços, a fila de cada servidor, o formulário de conexão e a exclusão do espaço local.
- O trabalho de `product-events` mantém a rota web, publicação e consumo de eventos, testes de integração e de interface, e a ponte Rust/TypeScript usada pelo aplicativo. A sincronização continua passando pelos adaptadores de cada plataforma.
- Os arquivos ignorados, dependências instaladas, dados de teste e os resultados de build ficam fora do Git. A comparação com as árvores originais confirmou os mesmos arquivos, conteúdos, índices, diferenças e branches antes e depois da migração.

## Entregas

O workflow web preserva as imagens do app e das ferramentas no GHCR, com `latest` em `main` e `dev` em `dev`. Um push de tag `vX.Y.Z` que corresponda à versão Tauri publica as duas imagens versionadas no GHCR e os 11 instaladores de Linux, Windows e macOS no GitHub Releases. [Instruções de release](../README.md#releases)

O build Docker usa a raiz para acessar os pacotes do workspace. O ambiente de desenvolvimento e o ambiente de produção foram iniciados com bancos PostgreSQL 18 descartáveis. O build de produção Linux x64, a migração, a CLI, o endpoint de saúde e o CSS estático via HTTPS foram verificados. Os Compose de produção foram conferidos estruturalmente, inclusive a variante com túnel usando valores de teste.
