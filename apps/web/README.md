# Feito web: installation

**English** | [Português (Brasil)](README.pt-br.md)

Feito web runs with Docker Compose using public images from the GitHub Container Registry. Choose one of these two setups:

| Setup | When to use it | What you need |
| --- | --- | --- |
| [A. Database in Docker](#a-database-in-docker) | Try it on your computer or deploy to a server with a public IP | Ports 80 and 443 open for public deployments |
| [B. Supabase with Cloudflare Tunnel](#b-supabase-with-cloudflare-tunnel) | A server with no open ports and a managed database | A Supabase project and a domain on Cloudflare |

The commands below work in Bash, Zsh, and Fish and must be run from the repository root.

## Browser usage

The interface defaults to English. Change it in **Settings → Appearance → Language**. Previously selected languages are preserved. The labels below include the Brazilian Portuguese equivalents.

Task descriptions support Markdown: headings, bold, italics, lists, links, blockquotes, code, and tables. Click a description to edit its source; when you leave the field, the formatted text reappears. In the detail view, the description is saved when you leave the field; when creating a task or editing inline, submit the form. Checklists are displayed as part of the text; click the description to change their markers. Formatting also appears in the desktop app and shared project details.

On the **Sign in** (Entrar) screen, choose **Use in this browser without an account** (Usar neste navegador, sem conta) or sign in to your Feito account. The workspace without an account is separate from the account's synced copy. Once **Settings → Offline access** (Ajustes → Acesso offline) indicates that preparation is complete, Feito can be reopened without a connection. Initial preparation requires a network connection and works in the production build.

The browser stores the copy and pending changes in IndexedDB. For accounts, changes sync when the connection returns. An expired session prompts you to sign in again and preserves the queue. **Sign out** (Sair) deletes that account's copy and asks for confirmation if there are pending changes. Use **Settings → Data** (Ajustes → Dados) to export a backup of the open workspace. [Browser workspace implementation](../../docs/06-browser-local-first-implementation.md#implementa%C3%A7%C3%A3o).

## Requirements

- Docker with the Docker Compose plugin, Git, and OpenSSL.
- A `linux/amd64` host. On ARM hosts, such as Apple Silicon or Raspberry Pi, the images run through emulation and are slower.

## Download and configure

```sh
git clone https://github.com/danilo-alm/feito.git
cd feito
```

The `new-env.sh` script generates passwords, secrets, and encryption keys in a private file outside the repository. Provide the HTTPS address you will use to open Feito:

- On your computer: `https://localhost:3000`.
- On a server: your domain, for example `https://feito.example.org`.

The generated file includes `FEITO_PRODUCT_CACHE_MODE=single-process`, which enables the RAM cache for Today, Upcoming, and projects in installations running a single Feito process. If more than one process serves the installation or writes Feito data, use `FEITO_PRODUCT_CACHE_MODE=revision`. To enable the cache in an existing single-process installation, add `FEITO_PRODUCT_CACHE_MODE=single-process` to the environment file and repeat the `up -d --wait` command for your chosen setup. See the [cache guide](../../docs/03-operations.md#cache-interno-de-leituras-do-produto) for operating conditions and the procedure after administrative changes.

> [!IMPORTANT]
> Keep a secure copy of `~/.config/feito/feito.env`. Without the keys in this file, a database backup cannot be decrypted. Reuse the same file for every update.

## A. Database in Docker

```sh
scripts/new-env.sh ~/.config/feito/feito.env --origin https://localhost:3000
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env up -d --wait
```

Compose starts PostgreSQL 18, applies migrations, and places Caddy in front of the app to handle HTTPS.

- **With a domain**: point DNS to the server and make ports 80 and 443 accessible. Caddy issues the certificate automatically.
- **On `localhost`**: Caddy uses a local certificate authority. To make your browser and [Feito desktop](../desktop/README.md) trust it, export the root certificate and add it to your system's trusted authorities:

  ```sh
  docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env cp caddy:/data/caddy/pki/authorities/local/root.crt ./feito-local-ca.crt
  ```

Continue to [Create the first account](#create-the-first-account).

## B. Supabase with Cloudflare Tunnel

In this setup, `cloudflared` carries traffic from Cloudflare to the app, and no container exposes ports. The database is a Supabase project with certificate verification enabled.

**Generate the configuration.** In the Supabase dashboard, open **Connect → Session pooler → View parameters** and note the host. The project reference is the part after `postgres.` in the pooler username.

```sh
scripts/new-env.sh ~/.config/feito/feito.env --origin https://feito.example.org --supabase --project-ref YOUR_PROJECT_REF --pooler-host POOLER_HOST
```

The Session pooler works on IPv4-only networks. To use a direct connection, replace `--supabase` with `--supabase-direct` and omit `--pooler-host`. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres)

**Database certificate.** Under **Database Settings → SSL Configuration**, download the certificate, save it in `~/.config/feito/`, and record the path:

```sh
chmod 644 ~/.config/feito/prod-ca-2021.crt
echo "FEITO_POSTGRES_CA_FILE=$HOME/.config/feito/prod-ca-2021.crt" >> ~/.config/feito/feito.env
```

**Tunnel token.** In the Cloudflare Zero Trust dashboard, open **Networks → Tunnels**, select the tunnel, and copy the value after `--token` in the connector installation command.

```sh
printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' 'PASTE_TOKEN_HERE' >> ~/.config/feito/feito.env
```

Under **Public Hostname**, point the domain to the `HTTP` service with URL `app:3000`. Keep only this connector in the tunnel and enable **Always Use HTTPS** for the zone.

**Create the database users and start the app.** Run the first command once per database; it prompts for the Supabase database password.

```sh
scripts/init-external-db.sh ~/.config/feito/feito.env
docker compose -f compose.prod.tunnel.yaml --env-file ~/.config/feito/feito.env up -d --wait
```

To confirm public access, `curl -sS https://feito.example.org/api/health` should return `{"status":"ok"}`. See [Operations](../../docs/03-operations.md#produção-com-postgresql-externo-e-cloudflare-tunnel) for other PostgreSQL providers and troubleshooting `502` errors.

## Create the first account

Registration is closed: each account is created from the command line. Use the same Compose file as your chosen setup. The command prompts for a temporary password, and Feito requires a password change on first sign-in.

```sh
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env run --rm cli pnpm admin account:create --email you@example.org
```

For setup B, replace `compose.prod.yaml` with `compose.prod.tunnel.yaml`. Then open the configured address in your browser.

## Update and stop

Before updating, create a [backup](../../docs/03-operations.md#backup-e-restauração-isolada). To download new images and restart, update the repository and run `up` again:

```sh
git pull
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env pull
docker compose -f compose.prod.yaml --env-file ~/.config/feito/feito.env up -d --wait --remove-orphans
```

To stop without deleting data, use `down` instead of `up -d --wait`. See [Operations and maintenance](../../docs/03-operations.md) for key rotation, other CLI operations, and running without Docker.
