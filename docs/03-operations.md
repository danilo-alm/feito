# Operação e detalhes de desenvolvimento

O [README](../README.md) mostra o caminho curto para rodar o Feito. Este documento reúne o resto: rodar sem Docker, detalhes das imagens, testes, backup, rotação de chaves e medições.

## Interface

As telas ficam em `src/app` (Entrar, troca de senha, Hoje, Em breve, Caixa de entrada, Projeto em Lista e Painel, Etiqueta, Busca e Ajustes) e os componentes em `src/components`. O cliente da API, o cache de leituras, as datas e as regras de organização ficam em `src/client`.

- Os estilos derivam dos tokens do design (`src/app/globals.css`), com tema claro, escuro e do sistema. O tema salvo nas preferências é aplicado antes da primeira pintura.
- Acima de 900 px a navegação é a barra lateral. Abaixo disso, a barra inferior (Entrada, Hoje, Em breve e Navegar, que reúne busca, ajustes, projetos e etiquetas), o botão de criar e as folhas substituem popovers e modais.
- Arrastar e soltar usa `@dnd-kit/core` com mouse no desktop e toque prolongado (400 ms) no celular, com rolagem automática nas bordas. `src/client/tree.ts` acompanha as regras de `POST /tasks/{id}/move` para validar o destino, evitar ciclos e respeitar a ordenação manual. O movimento aparece na interface enquanto o servidor confirma.
- Tudo que aparece ou some tem transição, com tokens de duração e curva e um mecanismo de presença comum. As regras estão em [Movimento e interação](04-motion-and-interaction.md).
- Menus ⋯, “Mover para…” e os atalhos Alt+↑/↓/←/→ (Alt+Shift+←/→ entre colunas do Painel) fazem as mesmas operações sem arrastar. `Q` abre a criação rápida e `/` a busca.

## Rodar sem Docker

Use Node.js 24, pnpm 10 e Docker Compose. Instale as dependências com `pnpm install --frozen-lockfile`.

Crie um arquivo privado **fora do checkout**. O [`scripts/new-env.sh`](../scripts/new-env.sh) gera um completo, com as URLs para `127.0.0.1`. Para montar à mão, parta de [`.env.example`](../.env.example), que contém apenas os nomes das variáveis. Use permissões `0600` e configure:

- `FEITO_ORIGIN` com a origem HTTPS exata, por exemplo `https://127.0.0.1:3000`, sem barra final.
- `BETTER_AUTH_SECRET` com um segredo independente de pelo menos 32 caracteres. Use `openssl rand -hex 32`. Defina `DATA_KEK_ACTIVE_VERSION` como `1` e gere outro segredo para `DATA_KEK_V1` com `openssl rand -base64 32`. Use uma KEK distinta em cada ambiente.
- `IMPORT_PREVIEW_SECRET` com um terceiro segredo independente, gerado com `openssl rand -hex 32`. Opcionalmente, configure `IMPORT_MAX_BYTES` em bytes. O padrão é 32 MiB e o máximo configurável é 64 MiB.
- As cinco senhas `POSTGRES_*_PASSWORD` com valores distintos. Use `openssl rand -hex 32` para cada uma. O Compose inicializa as roles ao criar o volume.
- As URLs de conexão no formato `postgresql://ROLE:SENHA@127.0.0.1:5432/feito`, usando a porta de `POSTGRES_PORT` se configurada. Cada URL usa a senha correspondente à role.

| Variável | Role | Senha |
| --- | --- | --- |
| `DOMAIN_DATABASE_URL` | `feito_app` | `POSTGRES_APP_PASSWORD` |
| `AUTH_DATABASE_URL` | `feito_auth` | `POSTGRES_AUTH_PASSWORD` |
| `MIGRATION_DATABASE_URL` | `feito_migrator` | `POSTGRES_MIGRATOR_PASSWORD` |
| `IDENTITY_ADMIN_DATABASE_URL` | `feito_identity_admin` | `POSTGRES_IDENTITY_ADMIN_PASSWORD` |

Execute a partir da raiz do projeto. Substitua os caminhos pelo arquivo e pelo diretório privados que você criou.

```sh
FEITO_ENV=/caminho/privado/feito.env
FEITO_LOCAL=/caminho/privado/feito-local

docker compose --env-file "$FEITO_ENV" up -d --wait postgres
set -a
. "$FEITO_ENV"
set +a
pnpm db:migrate
pnpm admin account:create --email pessoa@example.org
```

O comando de criação pede a senha provisória em um terminal interativo, com eco desativado. A conta é ativada com troca obrigatória no primeiro acesso. Lista, redefinição, revogação, desativação e reativação usam a mesma CLI. `account:list` escreve os dados solicitados no terminal. A auditoria fica na saída de erro, com usuário do sistema, operação, UUID da conta ou referência pseudonimizada, horário e resultado.

Gere um certificado local, mantenha sua chave no diretório privado e suba o Next.js em HTTPS:

```sh
(umask 077
 mkdir -p "$FEITO_LOCAL"
 openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
   -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
   -keyout "$FEITO_LOCAL/tls.key" -out "$FEITO_LOCAL/tls.crt")
(
  unset MIGRATION_DATABASE_URL IDENTITY_ADMIN_DATABASE_URL KEY_MAINTENANCE_DATABASE_URL
  unset POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATOR_PASSWORD POSTGRES_IDENTITY_ADMIN_PASSWORD
  unset POSTGRES_APP_PASSWORD POSTGRES_AUTH_PASSWORD
  pnpm dev --port 3000 \
    --experimental-https-key "$FEITO_LOCAL/tls.key" \
    --experimental-https-cert "$FEITO_LOCAL/tls.crt"
)
```

Em outro terminal, `curl --cacert /caminho/privado/feito-local/tls.crt https://127.0.0.1:3000/api/health` deve retornar `{"status":"ok"}`.

No acesso direto local, o limitador compartilha um bucket de origem. Atrás de um proxy confiável, configure `AUTH_CLIENT_IP_HEADER` com o nome do cabeçalho que o proxy sobrescreve com um único IP de cliente e restrinja o acesso direto ao Next.js. O limite inicial é de 8 tentativas por e-mail canônico e 30 por IP em 15 minutos, com até 2 logins simultâneos por processo. As sessões expiram em 7 dias.

Para ler segredos de arquivos, use `APP_SECRETS_DIR` apontando para um diretório privado com um arquivo por variável secreta de cada processo. Retire do ambiente os valores correspondentes. A origem, a versão ativa e o nome do cabeçalho continuam no ambiente. O processo HTTP exige apenas as credenciais de domínio e autenticação. A migração e a CLI usam suas próprias credenciais. No modo de arquivos, aponte cada processo para seu próprio diretório de segredos.

### Atualizar um banco da primeira revisão da Fase 1

Após `pnpm db:migrate`, se o banco contiver dados cifrados pela primeira revisão, grave uma vez o UUID antes configurado em `FEITO_INSTALLATION_ID`. Use a conexão de migração e substitua o marcador pelo UUID original.

```sql
INSERT INTO crypto_ops.legacy_aad (binding) VALUES ('<UUID original>');
```

O valor fica vinculado ao banco e permite abrir os registros existentes. A aplicação lê a configuração atual somente pelas versões e valores das KEKs.

## Docker em detalhe

O [`Dockerfile`](../Dockerfile) é multi-stage. `dev` roda `next dev` com o código montado do host, `tools` contém o código completo e as devDependencies para migração e CLIs, e `prod` leva só a saída standalone do Next.js, sem devDependencies, executando como usuário `node`. Cada Compose parte do stage correspondente. Em ambos, o [Caddy](../docker/Caddyfile) termina o TLS na frente do Next.js e sobrescreve `X-Real-IP`, lido via `AUTH_CLIENT_IP_HEADER`. Um serviço `migrate` aplica `pnpm db:migrate` antes de a aplicação subir.

O [`scripts/new-env.sh`](../scripts/new-env.sh) gera o arquivo privado de ambiente. No desenvolvimento e na produção com banco interno, o Compose monta as URLs a partir das senhas `POSTGRES_*_PASSWORD`. Na produção com banco externo, o Compose lê as URLs do arquivo. Cada processo recebe apenas as credenciais que usa. As KEKs aceitas são `DATA_KEK_V1` a `DATA_KEK_V3`.

### Desenvolvimento

```sh
docker compose -f compose.dev.yaml --env-file "$FEITO_ENV" up --build
```

A origem padrão é `https://localhost:3000`; para outra porta, defina `FEITO_ORIGIN` e `FEITO_HTTPS_PORT` juntos. Use `localhost`, não `127.0.0.1`: o Next.js só aceita o websocket de live reload de origens permitidas. Alterações em `src/` recarregam o navegador sem reiniciar o contêiner. `node_modules` vive num volume do contêiner, com binários para Linux. Depois de mudar `package.json` ou `pnpm-lock.yaml`, rode `up --build -V`.

O certificado vem da CA interna do Caddy. Para o navegador confiar nele, exporte a raiz e adicione-a ao chaveiro do sistema:

```sh
docker compose -f compose.dev.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./feito-dev-ca.crt
```

O projeto Compose se chama `feito-dev`. O PostgreSQL continua publicado em `127.0.0.1:${POSTGRES_PORT:-5432}` para ferramentas no host.

### Produção com PostgreSQL interno

```sh
docker compose -f compose.prod.yaml --env-file "$FEITO_ENV" up -d --build --wait
```

`FEITO_ORIGIN` é o endereço do site no Caddy. Com um domínio público (`https://feito.example.org`) e as portas 80 e 443 acessíveis, o certificado vem via ACME. Com `localhost` ou um IP, vem da CA interna. Para uma porta HTTPS diferente de 443, inclua-a em `FEITO_ORIGIN` e defina `FEITO_HTTPS_PORT` com o mesmo valor. O Next.js e o PostgreSQL não publicam portas no host. O contêiner da aplicação roda com sistema de arquivos somente leitura, sem capabilities, e tem healthcheck em `/api/health`.

### Produção com PostgreSQL externo

O [`compose.prod.external.yaml`](../compose.prod.external.yaml) sobe o Feito e o Caddy com a mesma configuração de produção. O PostgreSQL já deve estar acessível a partir do host e dos contêineres.

Para uma instalação nova, gere o arquivo privado e prepare o banco uma vez. Para o Supabase, use as [flags de geração do README](../README.md#parâmetros-para-supabase) no comando `new-env.sh`. Com o Session pooler, use o host do painel e `--username=postgres.SEU_PROJECT_REF` no `psql`. A imagem oficial `postgres:18` fornece o cliente, que pede a senha administrativa no terminal. O script lê as quatro senhas de serviço do arquivo gerado, cria as roles e concede ao migrador permissão para criar schemas no banco selecionado.

```sh
FEITO_ENV="$HOME/.config/feito/prod.env"
scripts/new-env.sh "$FEITO_ENV" --origin https://feito.example.org
(
  set -a
  . "$FEITO_ENV"
  set +a
  docker run --rm -it \
    -e POSTGRES_MIGRATOR_PASSWORD -e POSTGRES_APP_PASSWORD \
    -e POSTGRES_AUTH_PASSWORD -e POSTGRES_IDENTITY_ADMIN_PASSWORD \
    -e PGSSLMODE=require \
    --volume "$PWD/scripts/postgres-init.sql:/postgres-init.sql:ro" \
    postgres:18 \
    psql -X -W --single-transaction --set=feito_external=1 \
      --host=db.example.org --port=5432 --username=postgres --dbname=postgres \
      --file=/postgres-init.sql
)
```

As flags `--supabase` e `--supabase-direct` já configuram as quatro URLs com o banco `postgres` e `sslmode=require`. Se precisar ajustar as variáveis `*_DATABASE_URL` da [tabela acima](#rodar-sem-docker), defina o host, a porta e o banco externos. Mantenha a senha correspondente a cada role e configure TLS de acordo com o provedor. A senha `POSTGRES_BOOTSTRAP_PASSWORD` gerada serve ao banco interno.

No Supabase, o banco padrão se chama `postgres`. Use a conexão direta ou o pooler em modo **Session** na porta 5432. No pooler compartilhado, acrescente `.<project-ref>` ao nome do usuário, tanto no `psql` quanto nas URLs. O Feito usa o Better Auth e acessa seus schemas via PostgreSQL. [Conexões do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

```sh
docker compose -f compose.prod.external.yaml --env-file "$FEITO_ENV" up -d --build --wait
```

O serviço `migrate` aplica as migrações no banco externo antes de iniciar o app. Para criar contas e operar as chaves, use os comandos da seção a seguir com `compose.prod.external.yaml`.

### CLIs

O serviço `cli` pertence ao perfil `tools` e não sobe com `up`. Ele recebe as credenciais de administração de identidade e, se configurada, `KEY_MAINTENANCE_DATABASE_URL`:

```sh
docker compose -f compose.prod.yaml --env-file "$FEITO_ENV" run --rm cli pnpm admin account:create --email pessoa@example.org
docker compose -f compose.prod.yaml --env-file "$FEITO_ENV" run --rm cli pnpm keys kek:rewrap --tenant "$TENANT_ID"
```

Em desenvolvimento, troque `compose.prod.yaml` por `compose.dev.yaml`. O [`compose.yaml`](../compose.yaml) segue disponível para subir só o banco, como nos testes de integração abaixo.

## Testes

```sh
pnpm typecheck
pnpm test
pnpm build
```

Os testes ponta a ponta usam Playwright com Chromium headless em HTTPS, nos perfis desktop e celular. O passo a passo está em [`tests/e2e/README.md`](../tests/e2e/README.md).

Para a integração, use um arquivo privado de teste com chaves novas, outra porta de PostgreSQL e URLs atualizadas. O banco precisa ser PostgreSQL 18. A suíte cria contas e dados sintéticos nesse banco, usando `feito_auth`, `feito_app` e a role da CLI para as operações administrativas.

```sh
FEITO_TEST_ENV=/caminho/privado/feito-test.env
docker compose -p feito-test --env-file "$FEITO_TEST_ENV" up -d --wait postgres
(
  set -a
  . "$FEITO_TEST_ENV"
  set +a
  pnpm db:migrate && pnpm test:integration
)
```

A suíte verifica isolamento entre contas pelo HTTP e pelas políticas do PostgreSQL. Também cobre revisões concorrentes, arquivamento, ordenação, seções, movimentação de tarefas, vínculos com etiquetas, conclusão idempotente de ocorrências, virada de dia no fuso da conta, busca paginada e portabilidade entre contas com chaves de dados distintas.

Com o mesmo ambiente de integração carregado, `pnpm test:coverage` executa Vitest com cobertura V8 para as suítes unitária e de integração. O relatório no terminal e o HTML em `coverage/index.html` incluem as rotas da API, o domínio, as validações, os módulos de servidor e a lógica em `src/client`. O back-end tem limites agregados de 90% de linhas e 80% de ramificações. Os fluxos das telas e dos componentes React são exercitados pelo Playwright.

### CI e imagens

O workflow roda em pull requests e em pushes na `main` e na `dev`. Ele executa typecheck, build, testes unitários e de integração com cobertura e Playwright headless. O workflow migra um PostgreSQL 18 descartável e gera os segredos e o certificado HTTPS a cada execução. [Workflow do GitHub Actions](../.github/workflows/ci.yaml)

Em push na `main` ou na `dev`, com os testes aprovados, publica no GitHub Container Registry as imagens `ghcr.io/<dono>/feito` (alvo `prod`) e `ghcr.io/<dono>/feito-tools` (alvo `tools`), com as tags `sha-<commit>` e, conforme a branch, `latest` (`main`) ou `dev` (`dev`). Os pacotes nascem privados; torne-os públicos ou vincule-os ao repositório nas configurações do pacote, se necessário.

## Backup e chaves

A portabilidade exporta um JSON legível com os dados de uma conta. O backup PostgreSQL contém também identidades, hashes de senha e chaves de dados encapsuladas. Mantenha o backup cifrado e as versões da KEK em armazenamento recuperável separado.

Após a migração, execute [`scripts/postgres-maintenance.sql`](../scripts/postgres-maintenance.sql) com `psql` como DBA no banco do Feito. O script concede leitura global a `feito_backup` e operações de manutenção cifrada a `feito_keys`. Crie logins separados como membros dessas roles, com senha definida pelo prompt `\password` do `psql`. Use o login de manutenção somente na configuração privada de `KEY_MAINTENANCE_DATABASE_URL`.

### Backup e restauração isolada

Com o PostgreSQL 18, configure os parâmetros `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e `PGPASSFILE` para o login de backup. O Restic pode receber o dump diretamente e cancelar o snapshot se o comando falhar. [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [Restic e saída de comandos](https://restic.readthedocs.io/en/stable/040_backup.html#reading-data-from-a-command)

```sh
restic backup --stdin-from-command --stdin-filename feito.dump -- \
  pg_dump --format=custom --role=feito_backup
```

Para recuperar, use um banco vazio e isolado com os nomes de role do [bootstrap](../scripts/postgres-init.sql) e execute `scripts/postgres-maintenance.sql` com `psql -v roles_only=1` para criar as roles operacionais antes do dump ser restaurado. A restauração usa uma conexão de DBA e preserva as permissões do snapshot. Aponte os parâmetros `PG*` para esse destino antes de executar. [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [Restic dump](https://restic.readthedocs.io/en/stable/050_restore.html#printing-files-to-stdout)

```sh
set -o pipefail
restic dump "$SNAPSHOT_ID" feito.dump | pg_restore --exit-on-error --single-transaction
```

Invalide as sessões recuperadas com `DELETE FROM identity.session;` no banco isolado e verifique leitura com as KEKs originais. Se o snapshot reverteu contadores de cifragem, abra uma versão nova de KEK e ative uma nova DEK **para cada tenant antes de retomar escritas**. Confirme login e leitura e gravação de produto antes de abrir o acesso.

### Rotação local

Em um terminal de manutenção, carregue as KEKs antigas e a nova versão, com `DATA_KEK_ACTIVE_VERSION` apontando para a nova. Obtenha o UUID de tenant no schema de identidade por uma conexão administrativa.

```sh
pnpm keys kek:rewrap --tenant "$TENANT_ID"
pnpm keys dek:activate --tenant "$TENANT_ID"
pnpm keys dek:rekey --tenant "$TENANT_ID"
```

`kek:rewrap` reencapsula as DEKs em lotes, preservando os payloads. `dek:activate` cria uma versão nova a cada execução bem-sucedida. `dek:rekey` recifra os registros com a versão ativa e preserva IDs e revisões. Execute novamente `kek:rewrap` ou `dek:rekey` para retomar lotes interrompidos. Mantenha as KEKs necessárias aos snapshots retidos na custódia de backup.

## Medições

### Leituras e busca (Fase 3)

Next.js compilado, PostgreSQL 18 em Docker Compose e cliente HTTP no mesmo host ARM64. Cada cenário teve três chamadas de aquecimento e 20 medições sequenciais. A massa tinha 60% de tarefas concluídas, distribuídas em cinco grupos de projeto contando a Caixa de entrada, com descrições sintéticas de tamanhos variados. Hoje foi medido com `includeCompleted=true`. A busca seletiva filtrou por projeto, etiqueta e texto. A busca ampla comparou um trecho de descrição em toda a conta.

| Tarefas | Hoje p95 | Em breve p95 | Busca seletiva p95 | Busca ampla p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1.000 | 69 ms | 38 ms | 11 ms | 33 ms |
| 5.000 | 235 ms | 165 ms | 93 ms | 200 ms |
| 10.000 | 559 ms | 389 ms | 27 ms | 416 ms |

Na busca seletiva, foram decifradas 19, 91 e 182 tarefas, respectivamente, com 0,02, 0,09 e 0,18 MiB de dados cifrados. Na busca ampla, os volumes foram 1,01, 5,05 e 10,11 MiB. A decifragem e validação das tarefas da busca ampla teve p95 de 7, 61 e 130 ms. O pico de RSS amostrado do processo Next.js em cada massa foi de 490, 564 e 570 MiB.

### Portabilidade e recuperação (Fase 4)

O ciclo por HTTPS com 10.000 tarefas sintéticas exportou 12.504.889 bytes. A exportação levou 573 ms, a prévia 367 ms e a confirmação 903 ms em um host local ARM64. A reexportação da conta de destino preservou o conteúdo. Em um segundo ensaio, o mesmo volume de tarefas foi transferido com um corpo JSON de exatamente 32 MiB, completado com espaços. A prévia e a confirmação aceitaram esse corpo. Com um byte a mais, a prévia respondeu `413`.

O ensaio de recuperação usou `pg_dump` com a role dedicada e `pg_restore` em um segundo PostgreSQL 18, com o material da KEK carregado separadamente. A transferência e a restauração SQL da massa pequena levaram 174 ms. Foram verificados a revogação das sessões restauradas, o reenvelopamento de KEK, a recifragem de DEK e um novo login e uma nova gravação.
