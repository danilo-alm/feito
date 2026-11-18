#!/bin/sh
# Gera um arquivo de configuração com todos os segredos do Feito.
#
#   scripts/new-env.sh ~/.config/feito/dev.env
#   scripts/new-env.sh ~/.config/feito/prod.env https://feito.example.org
#
# O arquivo fica fora do projeto: o Next.js carrega qualquer .env da raiz e
# entregaria todas as senhas ao servidor HTTP.
set -eu

file=${1:?Uso: scripts/new-env.sh ARQUIVO [ORIGEM_HTTPS]}
origin=${2:-https://localhost:3000}

case $origin in
  https://*) ;;
  *) echo "A origem precisa começar com https:// ($origin)." >&2; exit 1 ;;
esac
if [ -e "$file" ]; then
  echo "$file já existe; não vou sobrescrever." >&2
  exit 1
fi

hostport=${origin#https://}
case $hostport in
  *:*) https_port=${hostport##*:} ;;
  *) https_port=443 ;;
esac

hex() { openssl rand -hex 32; }
app=$(hex) auth=$(hex) migrator=$(hex) identity_admin=$(hex)
db_port=5432

umask 077
mkdir -p "$(dirname "$file")"
cat > "$file" <<EOF
FEITO_ORIGIN=$origin
FEITO_HTTPS_PORT=$https_port
BETTER_AUTH_SECRET=$(hex)
IMPORT_PREVIEW_SECRET=$(hex)
DATA_KEK_ACTIVE_VERSION=1
DATA_KEK_V1=$(openssl rand -base64 32)
POSTGRES_PORT=$db_port
POSTGRES_BOOTSTRAP_PASSWORD=$(hex)
POSTGRES_MIGRATOR_PASSWORD=$migrator
POSTGRES_APP_PASSWORD=$app
POSTGRES_AUTH_PASSWORD=$auth
POSTGRES_IDENTITY_ADMIN_PASSWORD=$identity_admin
# Usadas só ao rodar sem Docker (o Compose monta as próprias URLs).
DOMAIN_DATABASE_URL=postgresql://feito_app:$app@127.0.0.1:$db_port/feito
AUTH_DATABASE_URL=postgresql://feito_auth:$auth@127.0.0.1:$db_port/feito
MIGRATION_DATABASE_URL=postgresql://feito_migrator:$migrator@127.0.0.1:$db_port/feito
IDENTITY_ADMIN_DATABASE_URL=postgresql://feito_identity_admin:$identity_admin@127.0.0.1:$db_port/feito
EOF
echo "Criado $file"
