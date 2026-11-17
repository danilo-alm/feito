# Feito

Backend self-hosted de tarefas pessoais. O backend entrega identidade, sessão, isolamento e armazenamento cifrado, além de navegação, projetos, seções, tarefas avulsas e etiquetas. O [contrato HTTP](docs/02-backend-endpoints.md) e a [arquitetura](docs/01-architecture-and-stack.md) descrevem as fases seguintes.

## Rodar localmente

Use Node.js 24, pnpm 10 e Docker Compose. Instale as dependências com `pnpm install --frozen-lockfile`.

Crie um arquivo privado **fora do checkout** a partir de [`.env.example`](.env.example). O exemplo contém apenas os nomes das variáveis. Use permissões `0600` e configure:

- `FEITO_ORIGIN` com a origem HTTPS exata, por exemplo `https://127.0.0.1:3000`, sem barra final.
- `BETTER_AUTH_SECRET` com um segredo independente de pelo menos 32 caracteres. Use `openssl rand -hex 32`. Defina `DATA_KEK_ACTIVE_VERSION` como `1` e gere outro segredo para `DATA_KEK_V1` com `openssl rand -base64 32`. Use uma KEK distinta em cada ambiente.
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
  unset MIGRATION_DATABASE_URL IDENTITY_ADMIN_DATABASE_URL
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

## Verificação

```sh
pnpm typecheck
pnpm test
pnpm build
```

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

A suíte verifica isolamento entre contas pelo HTTP e pelas políticas do PostgreSQL. Também cobre revisões concorrentes, arquivamento, ordenação, seções, movimentação de tarefas e vínculos com etiquetas.
