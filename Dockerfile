# syntax=docker/dockerfile:1
#
# Stages:
#   dev    → compose.dev.yaml  (next dev, código montado do host, live reload)
#   tools  → migração e CLIs (pnpm db:migrate, pnpm admin, pnpm keys) nos dois ambientes, empacotados (sem next nem devDependencies)
#   prod   → imagem de produção no GHCR (saída standalone do Next.js, sem devDependencies, usuário sem privilégios)

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install

# ---------------------------------------------------------------------------
# Todas as dependências (inclui devDependencies: drizzle-kit, tsx, typescript).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Código web e pacotes comuns com as devDependencies: base de dev, build e do bundle das ferramentas.
FROM deps AS source
COPY apps/web/ apps/web/
COPY packages/ packages/

# ---------------------------------------------------------------------------
# Empacota migrate, admin e keys em ESM autocontido (apps/web/scripts/build-tools.mjs).
# Só o argon2 nativo fica fora do bundle e é copiado da instalação desta mesma plataforma.
FROM source AS tools-bundle
RUN pnpm --filter @feito/web build:tools \
 && mkdir -p /out/node_modules/@node-rs \
 && cp -r apps/web/dist-tools/. /out/ \
 && cp -rL node_modules/.pnpm/node_modules/@node-rs/. /out/node_modules/@node-rs/ \
 && test -f /out/node_modules/@node-rs/argon2/package.json

# ---------------------------------------------------------------------------
# Ferramentas operacionais (pnpm db:migrate, pnpm admin, pnpm keys): node, pnpm,
# o bundle dos CLIs, as migrações e o argon2 nativo. Sem next, react nem devDependencies.
FROM base AS tools
ENV NODE_ENV=production
COPY --from=tools-bundle /out/ ./
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
# Desenvolvimento: código montado do host e dependências Linux da imagem.
FROM source AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "--filter", "@feito/web", "dev:container"]

# ---------------------------------------------------------------------------
FROM source AS build
ENV NODE_ENV=production
RUN pnpm --filter @feito/web build

# ---------------------------------------------------------------------------
# Produção: apenas o servidor standalone rastreado pelo Next.js.
FROM node:${NODE_VERSION}-bookworm-slim AS prod
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
