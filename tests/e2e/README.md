# Testes ponta a ponta

Os testes usam o Chrome instalado (`channel: "chrome"`) contra um servidor Feito local em HTTPS, com banco próprio de teste. O certificado local é fixado pela chave pública; a verificação de TLS continua ligada.

```sh
FEITO_TEST_ENV=/caminho/privado/feito-e2e.env   # mesmo formato do .env.example
FEITO_E2E_CERT=/caminho/privado/tls.crt         # certificado usado pelo `pnpm dev`
```

Com o servidor rodando (veja o README principal), execute:

```sh
set -a; . "$FEITO_TEST_ENV"; set +a
FEITO_E2E_URL=https://127.0.0.1:3000 FEITO_E2E_CERT="$FEITO_E2E_CERT" NODE_EXTRA_CA_CERTS="$FEITO_E2E_CERT" pnpm test:e2e
```

O setup global cria contas novas pela camada de administração (`IDENTITY_ADMIN_DATABASE_URL`) e guarda as credenciais e sessões em `tests/e2e/.auth/`, fora do Git. Cada projeto de teste (desktop e celular) entra uma única vez, para não esbarrar no limite de tentativas de login.
