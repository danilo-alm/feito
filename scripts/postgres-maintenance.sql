\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feito_backup') THEN
    CREATE ROLE feito_backup NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feito_keys') THEN
    CREATE ROLE feito_keys NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;
END
$$;

GRANT feito_app TO feito_keys;
SELECT format('GRANT CONNECT ON DATABASE %I TO feito_backup, feito_keys', current_database())
\gexec
\if :{?roles_only}
  \quit
\endif

GRANT USAGE ON SCHEMA identity, domain, crypto_ops, drizzle TO feito_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, domain, crypto_ops, drizzle TO feito_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA identity, domain, crypto_ops, drizzle TO feito_backup;

GRANT UPDATE (kek_version, aad_version, nonce, tag, ciphertext) ON domain.tenant_keys TO feito_keys;
GRANT UPDATE (dek_version, payload_version, nonce, tag, ciphertext) ON domain.completed_occurrences TO feito_keys;
