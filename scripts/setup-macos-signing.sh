#!/usr/bin/env bash
# Imports the Feito signing certificate into a temporary keychain for the macOS release build and
# exports APPLE_SIGNING_IDENTITY for Tauri. Falls back to ad hoc signing ("-") when the
# certificate secrets are not configured, such as on forks.
set -euo pipefail

identity="Feito Desktop Signing"

if [[ -z "${MACOS_CERTIFICATE:-}" || -z "${MACOS_CERTIFICATE_PASSWORD:-}" ]]; then
  echo "::warning::MACOS_CERTIFICATE secrets are missing. Using an ad hoc signature, so macOS will ask for keychain access again after every update."
  echo "APPLE_SIGNING_IDENTITY=-" >> "$GITHUB_ENV"
  exit 0
fi

keychain="$RUNNER_TEMP/feito-signing.keychain-db"
keychain_password="$(openssl rand -base64 24)"
certificate="$RUNNER_TEMP/feito-signing.p12"

echo "::add-mask::$keychain_password"
printf '%s' "$MACOS_CERTIFICATE" | base64 --decode > "$certificate"

security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$certificate" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$certificate"
# Lets codesign use the key without an interactive prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
# Keep the default keychains in the search list so the build still finds its other tools.
# shellcheck disable=SC2046
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

if ! security find-identity -p codesigning "$keychain" | grep -q "$identity"; then
  echo "::error::The imported certificate does not contain the \"$identity\" identity."
  exit 1
fi
echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
