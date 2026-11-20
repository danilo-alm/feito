// Cria uma conta com senha provisória para os testes ponta a ponta.
// Uso: FEITO_E2E_PASSWORD=... node --conditions=react-server --import=tsx tests/e2e/create-account.ts email
import "server-only";
import { readAuthConfig } from "@/server/crypto/config";
import { connectDatabase } from "@/server/db/client";
import { createAccount } from "@/server/services/admin";

const email = process.argv[2];
const password = process.env.FEITO_E2E_PASSWORD;
if (!email || !password) {
  process.stderr.write("Informe o e-mail e FEITO_E2E_PASSWORD.\n");
  process.exit(1);
}
async function main(address: string, secret: string) {
  const admin = connectDatabase("IDENTITY_ADMIN_DATABASE_URL", 1);
  try {
    await createAccount({ db: admin.db, config: readAuthConfig() }, address, secret);
  } finally {
    await admin.close();
  }
}

main(email, password).catch((error: unknown) => {
  process.stderr.write(`Falha ao criar a conta de teste: ${error instanceof Error ? error.name : "erro"}\n`);
  process.exit(1);
});
