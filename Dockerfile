# syntax=docker/dockerfile:1
#
# Stages:
#   dev    → compose.dev.yaml  (next dev, código montado do host, live reload)
#   tools  → migração e CLIs (pnpm db:migrate, pnpm admin, pnpm keys) nos dois ambientes
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
# Ferramentas operacionais: código web e pacotes comuns com as devDependencies.
FROM deps AS tools
COPY apps/web/ apps/web/
COPY packages/ packages/
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
# Desenvolvimento: código montado do host e dependências Linux da imagem.
FROM tools AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "--filter", "@feito/web", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# ---------------------------------------------------------------------------
FROM tools AS build
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
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
