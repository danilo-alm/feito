\set ON_ERROR_STOP on
\getenv migrator_password POSTGRES_MIGRATOR_PASSWORD
\getenv app_password POSTGRES_APP_PASSWORD
\getenv auth_password POSTGRES_AUTH_PASSWORD
\getenv identity_admin_password POSTGRES_IDENTITY_ADMIN_PASSWORD

CREATE ROLE feito_migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE feito_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE feito_auth LOGIN PASSWORD :'auth_password' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE feito_identity_admin LOGIN PASSWORD :'identity_admin_password' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

GRANT feito_auth TO feito_identity_admin;

\if :{?feito_external}
SELECT current_database() AS feito_database \gset
GRANT CONNECT, CREATE ON DATABASE :"feito_database" TO feito_migrator;
GRANT CONNECT ON DATABASE :"feito_database" TO feito_app, feito_auth, feito_identity_admin;
\else
ALTER DATABASE feito OWNER TO feito_migrator;
REVOKE ALL ON DATABASE feito FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE feito TO feito_app, feito_auth, feito_identity_admin;
\endif
