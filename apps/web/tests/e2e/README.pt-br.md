# Testes ponta a ponta

[English](README.md) | **Português (Brasil)**

A partir da raiz do monorepo, o Playwright usa o Chromium headless nos perfis desktop e celular. Prepare um PostgreSQL descartável, conforme o [guia de integração](../../../../docs/03-operations.md#testes), com `FEITO_ORIGIN=https://127.0.0.1:3100` no arquivo de ambiente.

```sh
pnpm --filter @feito/web exec playwright install --only-shell chromium
pnpm --filter @feito/web build
FEITO_TEST_ENV=/caminho/privado/feito-e2e.env
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

Em Linux, use `pnpm --filter @feito/web exec playwright install --with-deps --only-shell chromium` para instalar também as dependências do sistema. Com `FEITO_E2E_KEY`, o Playwright serve o build de produção do Next.js em HTTPS, espera `/api/health` e encerra o servidor ao fim da suíte. Para usar um servidor de teste que já esteja rodando em HTTPS, omita `FEITO_E2E_KEY` e aponte a URL e os certificados para ele. O Chromium fixa a chave pública do certificado por `FEITO_E2E_CERT`, e o Node confia no certificado via `NODE_EXTRA_CA_CERTS`.

O teste de atualização offline simula uma nova versão do service worker com `tests/e2e/serve.mjs`. Se esse servidor já estiver rodando quando a suíte começar, use `FEITO_E2E_LOCAL_SERVER=1` para incluir o teste.

O setup global cria contas novas pela camada de administração (`IDENTITY_ADMIN_DATABASE_URL`) e guarda os estados de sessão em `tests/e2e/.auth/`, fora do Git. Cada perfil (desktop e celular) reusa sua própria sessão. O teste de autenticação usa uma conta separada e percorre o login pela interface.
