#!/usr/bin/env bash
# Generates the self-signed code-signing certificate used for Feito's macOS installers.
#
# macOS ties "Always Allow" for keychain items to the app's code identity. An ad hoc signature
# identifies the app by its binary hash, which changes on every build, so the system asks again
# after each update. Signing every release with this same certificate keeps the identity stable.
#
# Usage: scripts/macos-signing-cert.sh [output-directory]
# Then store the two printed values as GitHub Actions secrets (Settings > Secrets and variables).
set -euo pipefail

name="Feito Desktop Signing"
directory="${1:-$PWD/feito-signing}"

if [[ -e "$directory" ]]; then
  echo "$directory already exists. Refusing to overwrite an existing certificate." >&2
  exit 1
fi
umask 077
mkdir -p "$directory"

password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

cat > "$directory/openssl.cnf" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CONF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -config "$directory/openssl.cnf" \
  -keyout "$directory/key.pem" -out "$directory/cert.pem" 2>/dev/null

# 3DES/SHA1 keeps the bundle importable by `security import` on every macOS version.
openssl pkcs12 -export -inkey "$directory/key.pem" -in "$directory/cert.pem" \
  -name "$name" -passout "pass:$password" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -out "$directory/feito-signing.p12"

base64 < "$directory/feito-signing.p12" | tr -d '\n' > "$directory/feito-signing.p12.base64"
rm "$directory/openssl.cnf"

cat <<MSG
Certificate created in $directory. Keep this folder private and outside the repository:
losing it means a new certificate, and one more system prompt after the next update.

Add these GitHub Actions secrets:
  MACOS_CERTIFICATE           contents of $directory/feito-signing.p12.base64
  MACOS_CERTIFICATE_PASSWORD  $password

With GitHub CLI:
  gh secret set MACOS_CERTIFICATE < "$directory/feito-signing.p12.base64"
  printf '%s' '$password' | gh secret set MACOS_CERTIFICATE_PASSWORD
MSG
