# syntax=docker/dockerfile:1
#
# Stages:
#   dev    → compose.dev.yaml  (next dev, código montado do host, live reload)
#   tools  → migração e CLIs (pnpm db:migrate, pnpm admin, pnpm keys) nos dois ambientes
#   prod   → compose.prod.yaml (saída standalone do Next.js, sem devDependencies, usuário sem privilégios)

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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Desenvolvimento: o código chega por bind mount; node_modules fica na imagem
# (binários nativos do Linux, como @node-rs/argon2, não podem vir do macOS).
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# ---------------------------------------------------------------------------
# Ferramentas operacionais: código completo + devDependencies.
FROM deps AS tools
COPY . .
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
FROM deps AS build
ENV NODE_ENV=production
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Produção: apenas o servidor standalone rastreado pelo Next.js.
FROM node:${NODE_VERSION}-bookworm-slim AS prod
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
