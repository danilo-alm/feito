# Feito

Feito é um app de tarefas pessoais que você hospeda na sua máquina ou no seu servidor. Capture tarefas na Caixa de entrada, planeje o que fazer em Hoje e Em breve e organize seus projetos em listas ou painéis. O app oferece subtarefas, etiquetas, prioridades e recorrência, além de importação do Todoist e exportação de dados. Os dados de tarefas e projetos são armazenados cifrados no PostgreSQL.

![Visão Hoje com tarefas do dia, atrasos, horários e prioridades](docs/screenshots/hoje.png)

<details>
<summary>Ver um projeto em painel e a interface no celular</summary>

![Projeto Site do estúdio em painel, com colunas A fazer, Em andamento e Em revisão](docs/screenshots/quadro.png)

![Visão Hoje no celular, com navegação inferior](docs/screenshots/hoje-no-celular.png)

</details>

## Instalação

Você precisa de Docker com o plugin Docker Compose, Git e OpenSSL. Execute os comandos em um shell como Bash ou Zsh. Para configurar um PostgreSQL externo, o Docker também executa o cliente `psql` usado no comando abaixo.

O Docker Compose baixa as imagens públicas do Feito no GitHub Container Registry. As imagens usam `linux/amd64` e exigem emulação em hosts ARM.

```sh
git clone https://github.com/danilo-alm/feito.git
cd feito

FEITO_ENV="$HOME/.config/feito/feito.env"
```

Para instalar num servidor público, substitua `https://localhost:3000` pelo domínio HTTPS do Feito, por exemplo `https://feito.example.org`. Aponte o DNS para o servidor e deixe as portas 80 e 443 acessíveis para que o Caddy emita o certificado. Use o mesmo endereço para abrir o app depois de instalar.

O script gera as credenciais e as chaves de criptografia. Mantenha o arquivo fora da pasta do projeto, preserve-o ao atualizar a instalação e guarde uma cópia segura. Você precisará das chaves para recuperar os dados cifrados de um backup.

### Opção A — PostgreSQL no Docker

```sh
scripts/new-env.sh "$FEITO_ENV" --origin https://localhost:3000
FEITO_COMPOSE=compose.prod.yaml
docker compose -f "$FEITO_COMPOSE" --env-file "$FEITO_ENV" up -d --wait
```

O Compose inicia o PostgreSQL 18, cria as credenciais do banco na primeira inicialização do volume e aplica as migrações. Depois, siga para [Criar a primeira conta](#criar-a-primeira-conta).

### Opção B — PostgreSQL externo

Use um banco acessível pelo host e pelos contêineres do Feito. Para a configuração inicial, obtenha o host, a porta, o nome do banco e um login administrativo que possa criar usuários e conceder permissão de criação de schemas.

#### Parâmetros para Supabase

No painel do projeto Supabase, abra **Connect** e copie os dados de conexão do PostgreSQL. O banco padrão se chama `postgres`. Ambos os modos abaixo usam a porta `5432`.

Em uma rede IPv4, selecione **Session pooler** em **Connect**. Use `--supabase` para gerar as credenciais. O script pede a referência do projeto (o trecho após `postgres.` no usuário do pooler) e o host mostrado em **View parameters**.

```sh
scripts/new-env.sh "$FEITO_ENV" --origin https://localhost:3000 --supabase
```

Para passar esses dados pelo comando, acrescente `--project-ref SEU_PROJECT_REF` e `--pooler-host HOST_DO_POOLER`. Para conexão direta, use `--supabase-direct` e informe a referência quando o script perguntar ou via `--project-ref`. Os dois modos preenchem as quatro URLs automaticamente. Se você já gerou o arquivo, ajuste as URLs conforme o passo abaixo para preservar as senhas e chaves existentes.

| Campo | Conexão direta | Pooler Session |
| --- | --- | --- |
| Host | `db.<project-ref>.supabase.co` | Host do **Session pooler** mostrado em **Connect** |
| Usuário administrativo | `postgres` | `postgres.<project-ref>` |
| Usuário de cada URL do Feito | Nome da role, por exemplo `feito_app` | Nome da role com sufixo, por exemplo `feito_app.<project-ref>` |

Se a rede do servidor só tiver IPv4, use o pooler **Session** ou uma conexão direta com o adicional de IPv4. Use a senha do banco do Supabase no comando de inicialização. O Feito gerencia o login dos usuários pelo Better Auth. [Conexões do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

#### Criar os usuários do banco e iniciar

Para outro provedor, gere primeiro o arquivo com `scripts/new-env.sh "$FEITO_ENV" --origin https://localhost:3000` e configure as URLs antes de inicializar o banco.

Se você gerou `$FEITO_ENV` com `--supabase` ou `--supabase-direct`, as quatro URLs já estão prontas. Caso precise ajustá-las, defina o host, a porta e o banco externos e conserve a senha gerada para cada usuário. No Session pooler, use o host do painel e acrescente `.<project-ref>` ao usuário em cada URL. As URLs do Supabase devem terminar com `?sslmode=require`. Para outro provedor, use os parâmetros de TLS indicados por ele.

| Variável | Usuário do PostgreSQL |
| --- | --- |
| `DOMAIN_DATABASE_URL` | `feito_app` |
| `AUTH_DATABASE_URL` | `feito_auth` |
| `MIGRATION_DATABASE_URL` | `feito_migrator` |
| `IDENTITY_ADMIN_DATABASE_URL` | `feito_identity_admin` |

Execute uma vez o script abaixo. Ele obtém o host, a porta e o banco de `MIGRATION_DATABASE_URL` e usa o usuário administrativo `postgres` ou `postgres.<project-ref>` no Session pooler. Para um provedor com outro usuário administrativo, acrescente `--admin-user USUÁRIO`.

```sh
scripts/init-external-db.sh "$FEITO_ENV"
```

Quando o `psql` pedir `Password:`, informe a senha administrativa do banco. O `psql` roda na imagem `postgres:18` e o script cria as quatro roles com as senhas geradas no arquivo.

```sh
FEITO_COMPOSE=compose.prod.external.yaml
docker compose -f "$FEITO_COMPOSE" --env-file "$FEITO_ENV" up -d --wait
```

O serviço de migração prepara as tabelas antes de o app iniciar.

### Criar a primeira conta

Com o arquivo Compose da opção escolhida, crie a conta com seu e-mail. O comando pede uma senha provisória e o Feito solicita a troca no primeiro acesso.

```sh
docker compose -f "$FEITO_COMPOSE" --env-file "$FEITO_ENV" \
  run --rm cli pnpm admin account:create --email voce@example.org
```

Abra [https://localhost:3000](https://localhost:3000) ou o domínio que você configurou. Em localhost, o Caddy emite o certificado com uma autoridade local. Para o navegador confiar nela, exporte o certificado raiz e adicione-o às autoridades confiáveis do seu sistema ou navegador.

```sh
docker compose -f "$FEITO_COMPOSE" --env-file "$FEITO_ENV" \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./feito-local-ca.crt
```

### Atualizar ou parar

Para baixar as imagens mais recentes e atualizar a instalação, execute novamente `up -d --wait` com o mesmo arquivo de ambiente e a mesma opção de banco. Antes de atualizar, consulte as [instruções de backup e restauração](docs/03-operations.md#backup-e-restauração-isolada).

Para parar a instalação preservando os volumes do Docker:

```sh
docker compose -f "$FEITO_COMPOSE" --env-file "$FEITO_ENV" down
```

## Documentação

- [Operação e manutenção](docs/03-operations.md)
- [Arquitetura](docs/01-architecture-and-stack.md)
- [API](docs/02-backend-endpoints.md)
- [Movimento e interação](docs/04-motion-and-interaction.md)
- [Marca](docs/05-brand.md)
