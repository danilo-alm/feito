# Feito

Aplicação self-hosted de tarefas pessoais. Next.js + PostgreSQL, com os dados de cada conta cifrados no banco.

Você só precisa de Docker para rodar. Para os testes, também de Node.js 24 e pnpm 10.

## 1. Gerar a configuração

O Feito precisa de senhas do banco e chaves de criptografia. Este script gera um arquivo com tudo:

```sh
scripts/new-env.sh ~/.config/feito/dev.env
```

O arquivo fica **fora** da pasta do projeto de propósito: o Next.js carrega qualquer `.env` da raiz e entregaria todas as senhas ao servidor. Guarde-o bem, porque sem as chaves os dados cifrados não podem ser lidos.

## 2. Rodar

### Desenvolvimento

```sh
docker compose -f compose.dev.yaml --env-file ~/.config/feito/dev.env up --build
```

Abra <https://localhost:3000>. Ao salvar um arquivo em `src/`, o navegador recarrega sozinho. O navegador vai avisar que o certificado não é confiável; aceite, ou confie na CA local de uma vez:

```sh
docker compose -f compose.dev.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./feito-dev-ca.crt
```

Depois, abra o `feito-dev-ca.crt` no Acesso às Chaves e marque como confiável.

Depois de mudar dependências (`package.json` ou `pnpm-lock.yaml`), suba com `up --build -V`.

### Produção

Gere uma configuração própria, com o endereço público, e suba:

```sh
scripts/new-env.sh ~/.config/feito/prod.env https://feito.example.org
docker compose -f compose.prod.yaml --env-file ~/.config/feito/prod.env up -d --build
```

O domínio precisa apontar para o servidor, com as portas 80 e 443 abertas. O certificado HTTPS é emitido automaticamente.

### Parar

```sh
docker compose -f compose.dev.yaml down
```

Em produção, use `compose.prod.yaml` e o arquivo de produção. Os dados ficam em volumes do Docker; `down -v` apaga o banco.

## 3. Comandos do dia a dia

As migrações do banco rodam sozinhas ao subir. Os comandos abaixo usam o ambiente de desenvolvimento; em produção, troque o arquivo do Compose e o de configuração.

**Contas.** Não existe cadastro público: as contas são criadas pela linha de comando. A senha é pedida no terminal, e a pessoa troca no primeiro acesso.

```sh
docker compose -f compose.dev.yaml --env-file ~/.config/feito/dev.env run --rm cli pnpm admin account:create --email voce@example.org
```

Outras ações, todas com `--email`: `account:list`, `account:reset-password`, `account:revoke-sessions`, `account:disable` e `account:enable`.

**Chaves de criptografia.** `pnpm keys kek:rewrap`, `dek:activate` e `dek:rekey`, com `--tenant`. Antes de usar, leia [Rotação de chaves](docs/03-operations.md#rotação-local).

**Banco.** Para abrir um `psql` no ambiente de desenvolvimento:

```sh
docker compose -f compose.dev.yaml exec postgres psql -U feito_migrator -d feito
```

**Testes e verificação.** Rodam no host, após `pnpm install`:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Testes de integração e ponta a ponta precisam de banco próprio; veja [Testes](docs/03-operations.md#testes).

**Nova migração.** Depois de alterar `src/server/db/schema.ts`, rode `pnpm db:generate` e reinicie o ambiente.

## Documentação

- [Arquitetura e stack](docs/01-architecture-and-stack.md)
- [Contrato da API](docs/02-backend-endpoints.md)
- [Operação e detalhes](docs/03-operations.md): rodar sem Docker, interface, backup, rotação de chaves e medições
