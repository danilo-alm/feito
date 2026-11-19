#!/bin/sh
# Inicializa as roles do Feito em um PostgreSQL externo.
set -eu

usage='Uso: scripts/init-external-db.sh ARQUIVO [--admin-user USUÁRIO]'
fail() { printf '%s\n' "$@" >&2; exit 1; }

case $# in
  1) admin_user= ;;
  3)
    [ "$2" = --admin-user ] && [ -n "$3" ] || fail "$usage"
    admin_user=$3
    ;;
  *) fail "$usage" ;;
esac

case $1 in
  /*) env_file=$1 ;;
  *) env_file=./$1 ;;
esac
[ -f "$env_file" ] && [ -r "$env_file" ] || fail "Não foi possível ler $env_file."

unset MIGRATION_DATABASE_URL POSTGRES_MIGRATOR_PASSWORD POSTGRES_APP_PASSWORD \
  POSTGRES_AUTH_PASSWORD POSTGRES_IDENTITY_ADMIN_PASSWORD
# Carrega o arquivo privado gerado por new-env.sh e repassa apenas as senhas das roles.
. "$env_file"
: "${POSTGRES_MIGRATOR_PASSWORD:?Defina POSTGRES_MIGRATOR_PASSWORD no arquivo.}"
: "${POSTGRES_APP_PASSWORD:?Defina POSTGRES_APP_PASSWORD no arquivo.}"
: "${POSTGRES_AUTH_PASSWORD:?Defina POSTGRES_AUTH_PASSWORD no arquivo.}"
: "${POSTGRES_IDENTITY_ADMIN_PASSWORD:?Defina POSTGRES_IDENTITY_ADMIN_PASSWORD no arquivo.}"

case ${MIGRATION_DATABASE_URL-} in
  postgres://*|postgresql://*) migration_url=${MIGRATION_DATABASE_URL#*://} ;;
  *) fail 'Defina MIGRATION_DATABASE_URL com a URL do PostgreSQL externo.' ;;
esac

# Mantém o destino e as opções da URL, removendo as credenciais do migrador.
authority=${migration_url%%/*}
case $migration_url in
  */?*) ;;
  *) fail 'Informe o banco de destino em MIGRATION_DATABASE_URL.' ;;
esac
case $authority in
  ?*@?*) ;;
  *) fail 'Informe o usuário e o host em MIGRATION_DATABASE_URL.' ;;
esac
endpoint=${migration_url#*@}
hostport=${endpoint%%/*}
case $hostport in
  127.0.0.1|127.0.0.1:*|localhost|localhost:*)
    fail 'Configure MIGRATION_DATABASE_URL com o host externo acessível pelo Docker.' ;;
esac

if [ -z "$admin_user" ]; then
  admin_user=postgres
  case $hostport in
    *.pooler.supabase.com|*.pooler.supabase.com:*)
      migration_user=${authority%%:*}
      case $migration_user in
        feito_migrator.?*) admin_user=postgres.${migration_user#feito_migrator.} ;;
        *) fail 'Use feito_migrator.<project-ref> em MIGRATION_DATABASE_URL para o Session pooler.' ;;
      esac
      ;;
  esac
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
export POSTGRES_MIGRATOR_PASSWORD POSTGRES_APP_PASSWORD \
  POSTGRES_AUTH_PASSWORD POSTGRES_IDENTITY_ADMIN_PASSWORD
PGSSLMODE=require
export PGSSLMODE

exec docker run --rm -it \
  -e POSTGRES_MIGRATOR_PASSWORD -e POSTGRES_APP_PASSWORD \
  -e POSTGRES_AUTH_PASSWORD -e POSTGRES_IDENTITY_ADMIN_PASSWORD -e PGSSLMODE \
  --volume "$script_dir/postgres-init.sql:/postgres-init.sql:ro" \
  postgres:18 \
  psql -X -W --single-transaction --set=feito_external=1 \
    --username="$admin_user" --dbname="postgresql://$endpoint" \
    --file=/postgres-init.sql
