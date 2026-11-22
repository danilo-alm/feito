# End-to-end tests

**English** | [Português (Brasil)](README.pt-br.md)

From the monorepo root, Playwright uses headless Chromium with desktop and mobile profiles. Prepare a disposable PostgreSQL instance as described in the [integration guide](../../../../docs/03-operations.md#testes), with `FEITO_ORIGIN=https://127.0.0.1:3100` in the environment file.

```sh
pnpm --filter @feito/web exec playwright install --only-shell chromium
pnpm --filter @feito/web build
FEITO_TEST_ENV=/private/path/feito-e2e.env
FEITO_TEST_TLS=$(mktemp -d)
(umask 077
 openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
   -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 \
   -keyout "$FEITO_TEST_TLS/tls.key" -out "$FEITO_TEST_TLS/tls.crt")
(
  set -a
  . "$FEITO_TEST_ENV"
  set +a
  FEITO_E2E_URL="$FEITO_ORIGIN" FEITO_E2E_KEY="$FEITO_TEST_TLS/tls.key" \
    FEITO_E2E_CERT="$FEITO_TEST_TLS/tls.crt" NODE_EXTRA_CA_CERTS="$FEITO_TEST_TLS/tls.crt" \
    pnpm test:e2e
)
```

On Linux, use `pnpm --filter @feito/web exec playwright install --with-deps --only-shell chromium` to also install system dependencies. With `FEITO_E2E_KEY`, Playwright serves the Next.js production build over HTTPS, waits for `/api/health`, and stops the server at the end of the suite. To use an HTTPS test server that is already running, omit `FEITO_E2E_KEY` and point the URL and certificates to it. Chromium pins the certificate's public key through `FEITO_E2E_CERT`, and Node trusts the certificate through `NODE_EXTRA_CA_CERTS`.

The offline update test simulates a new service worker version with `tests/e2e/serve.mjs`. If this server is already running when the suite starts, use `FEITO_E2E_LOCAL_SERVER=1` to include the test.

Global setup creates new accounts through the administration layer (`IDENTITY_ADMIN_DATABASE_URL`) and stores session states in `tests/e2e/.auth/`, outside Git. Each profile (desktop and mobile) reuses its own session. The authentication test uses a separate account and goes through sign-in using the interface.
