#!/bin/sh
# Gera um arquivo de configuração com todos os segredos do Feito.
#
#   scripts/new-env.sh ~/.config/feito/dev.env
#   scripts/new-env.sh ~/.config/feito/prod.env --origin https://feito.example.org --supabase
#
# O arquivo fica fora do projeto: o Next.js carrega qualquer .env da raiz e
# entregaria todas as senhas ao servidor HTTP.
set -eu

usage='Uso: scripts/new-env.sh ARQUIVO [--origin ORIGEM_HTTPS]
  [--supabase | --supabase-direct] [--project-ref REFERÊNCIA] [--pooler-host HOST]

--supabase         Usa o Session pooler do Supabase (IPv4).
--supabase-direct  Usa a conexão direta do Supabase.
--project-ref      Informa a referência do projeto sem prompt.
--pooler-host      Informa o host do Session pooler sem prompt.'

fail() { printf '%s\n' "$@" >&2; exit 1; }

if [ "${1-}" = --help ]; then
  printf '%s\n' "$usage"
  exit 0
fi
file=${1:?$usage}
shift

origin=https://localhost:3000
supabase_mode=
project_ref=
pooler_host=

# Mantém suporte aos comandos existentes que passam a origem como segundo argumento.
if [ "$#" -gt 0 ]; then
  case $1 in
    -*) ;;
    *) origin=${1:-$origin}; shift ;;
  esac
fi

while [ "$#" -gt 0 ]; do
  case $1 in
    --supabase) supabase_mode=session ;;
    --supabase-direct) supabase_mode=direct ;;
    --origin|--project-ref|--pooler-host)
      case ${2-} in
        ''|-*) fail "Informe um valor para $1." ;;
      esac
      case $1 in
        --origin) origin=$2 ;;
        --project-ref) project_ref=$2 ;;
        --pooler-host) pooler_host=$2 ;;
      esac
      shift
      ;;
    *) fail "Argumento desconhecido: $1" "$usage" ;;
  esac
  shift
done

case $origin in
  https://*) ;;
  *) fail "A origem precisa começar com https:// ($origin)." ;;
esac

if [ -e "$file" ]; then
  fail "$file já existe; não vou sobrescrever."
fi

if [ -n "$pooler_host" ] && [ "$supabase_mode" != session ]; then
  fail 'Use --pooler-host com --supabase.'
fi
if [ -n "$project_ref" ] && [ -z "$supabase_mode" ]; then
  fail 'Use --project-ref com --supabase ou --supabase-direct.'
fi

db_port=5432
db_endpoint="127.0.0.1:$db_port/feito"
db_user_suffix=
if [ -n "$supabase_mode" ]; then
  if [ -z "$project_ref" ]; then
    printf 'Referência do projeto Supabase: ' >&2
    IFS= read -r project_ref || fail 'Informe a referência com --project-ref.'
  fi
  case $project_ref in
    ''|*[!abcdefghijklmnopqrstuvwxyz0123456789]*)
      fail 'Informe apenas a referência do projeto Supabase, com letras minúsculas e dígitos.' ;;
  esac

  db_host="db.$project_ref.supabase.co"
  if [ "$supabase_mode" = session ]; then
    if [ -z "$pooler_host" ]; then
      printf 'Host do Session pooler (Connect → Session pooler → View parameters → host): ' >&2
      IFS= read -r pooler_host || fail 'Informe o host com --pooler-host.'
    fi
    pooler_label=${pooler_host%.pooler.supabase.com}
    case $pooler_label in
      ''|-*|*-|*[!abcdefghijklmnopqrstuvwxyz0123456789-]*)
        fail 'Informe apenas o host do Session pooler, por exemplo aws-0-regiao.pooler.supabase.com.' ;;
    esac
    [ "$pooler_host" = "$pooler_label.pooler.supabase.com" ] ||
      fail 'O host do Session pooler deve terminar em .pooler.supabase.com.'
    db_host=$pooler_host
    db_user_suffix=.$project_ref
  fi
  db_endpoint="$db_host:$db_port/postgres?sslmode=verify-full&sslrootcert=/run/config/feito-postgres-ca.crt"
fi

hostport=${origin#https://}
case $hostport in
  *:*) https_port=${hostport##*:} ;;
  *) https_port=443 ;;
esac

hex() { openssl rand -hex 32; }
app=$(hex) auth=$(hex) migrator=$(hex) identity_admin=$(hex)

umask 077
mkdir -p "$(dirname "$file")"
cat > "$file" <<EOF
# Aplicação e HTTPS
FEITO_ORIGIN=$origin
FEITO_HTTPS_PORT=$https_port
FEITO_PRODUCT_CACHE_MODE=single-process

# Segredos da aplicação
BETTER_AUTH_SECRET=$(hex)
IMPORT_PREVIEW_SECRET=$(hex)

# Criptografia dos dados
DATA_KEK_ACTIVE_VERSION=1
DATA_KEK_V1=$(openssl rand -base64 32)

# PostgreSQL e credenciais das roles
POSTGRES_PORT=$db_port
POSTGRES_BOOTSTRAP_PASSWORD=$(hex)
POSTGRES_MIGRATOR_PASSWORD=$migrator
POSTGRES_APP_PASSWORD=$app
POSTGRES_AUTH_PASSWORD=$auth
POSTGRES_IDENTITY_ADMIN_PASSWORD=$identity_admin

# URLs do PostgreSQL para execução sem Docker ou com compose.prod.tunnel.yaml
DOMAIN_DATABASE_URL='postgresql://feito_app$db_user_suffix:$app@$db_endpoint'
AUTH_DATABASE_URL='postgresql://feito_auth$db_user_suffix:$auth@$db_endpoint'
MIGRATION_DATABASE_URL='postgresql://feito_migrator$db_user_suffix:$migrator@$db_endpoint'
IDENTITY_ADMIN_DATABASE_URL='postgresql://feito_identity_admin$db_user_suffix:$identity_admin@$db_endpoint'
EOF
echo "Criado $file"
