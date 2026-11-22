# Agent guidelines for Feito

**English** | [Português (Brasil)](AGENTS.pt-br.md)

## Project

Feito is a self-hosted personal task web app. Its interface defaults to English and includes Inbox, Today, Upcoming, projects in List and Board views, subtasks, labels, search, recurring tasks, and import and export. Registration is closed, and each account has its own database tenant.

The monorepo contains the web app in [apps/web](apps/web) and the Tauri desktop app in [apps/desktop](apps/desktop). The desktop app works with a local workspace or syncs with a Feito installation over HTTPS. The [@feito/core](packages/core) and [@feito/ui](packages/ui) packages are the shared source. Read the [desktop AGENTS.md](apps/desktop/AGENTS.md) when working on Tauri or workspaces.

Use **Node.js 24**, **pnpm 10**, and **PostgreSQL 18**. The app uses Next.js App Router, React, and TypeScript. The API uses Zod, Better Auth, and Drizzle, with server-side envelope encryption. Tests use Vitest and Playwright. See `package.json`, `.node-version`, and `pnpm-lock.yaml` for the versions in use.

## Where to work

| Area | Path |
| --- | --- |
| Screens and navigation | [Web routes](apps/web/src/app), [shared screens](packages/ui/src/screens), [desktop entry point](apps/desktop/src/main.tsx) |
| Styles, components, and animation | [globals.css](packages/ui/src/globals.css), [ui.tsx](packages/ui/src/components/ui.tsx), [motion.tsx](packages/ui/src/components/motion.tsx) |
| HTTP client, cache, and optimistic mutations | [Shared client](packages/ui/src/client), [shared types](packages/core/src/types.ts) |
| Scheduling, recurrence, and hierarchy | [Domain](packages/core/src/domain), [validation](packages/core/src/validation), [product services](packages/core/src/product) |
| HTTP routes, sessions, encryption, and web persistence | [API](apps/web/src/app/api), [server](apps/web/src/server), [migrations](apps/web/drizzle) |
| Tests, CI, and administrative tools | [Web tests](apps/web/tests), [web CI](.github/workflows/web.yml), [desktop CI](.github/workflows/desktop.yml), [scripts](scripts) |

- Before editing, trace the flow from the screen or route through the implementation and tests. Reuse existing components, rules, and contracts. When historical documentation differs from the implementation, confirm current behavior in the code and tests.
- Keep changes within the requested scope and preserve changes already in the checkout. Prefer simple code, precise types, and clear names. Justify new dependencies with a concrete need.
- Preserve compatibility with API consumers and stored data. When changing a contract, update the types, callers, tests, and corresponding documentation.
- When changing shared modules, check the adapters and tests for both apps. Dependencies run from apps/web and apps/desktop to @feito/ui and @feito/core, and from @feito/ui to @feito/core. Navigation, persistence, and ID generation are supplied through adapters. Check the `/api/v1/desktop-sync` and `/api/v1/product-events` routes and migrations when validating an integrated installation.

## Frontend

- When the user requests an interface change without specifying web or desktop, implement it in both apps. Whenever possible, use the same shared component in `packages/ui`, keeping the interface and behavior consistent across web and desktop.
- Reuse the color, typography, focus, and motion tokens in `globals.css`. Use the common components in `ui.tsx` and the presence and reordering mechanisms in `motion.tsx` for interactions that appear, disappear, or change position.
- For visual or interaction changes, check the screen in a browser at desktop and mobile widths. Consider light and dark themes, keyboard and touch navigation, and reduced motion. Preserve content and focus order during transitions and reordering.
- Use semantic controls with accessible names and visible focus. Preserve initial focus and focus restoration in dialogs and menus. Keep keyboard or menu alternatives for drag actions.
- Represent relevant loading, empty, error, and retry states. During updates, preserve data and fields being edited that are still valid. Handle out-of-order responses, route changes, and concurrent actions.
- Use `packages/ui/src/client/api.ts` and `packages/ui/src/client/store.ts` to communicate with the API and update reads. Task mutations go through `task-mutations.ts` and `task-projections.ts`. Apply the optimistic local update, send the write, reconcile using the official response, and roll back only the action that failed. Preserve revision sequencing when actions depend on each other.
- When changing tasks, check the projections actually affected, including subtasks, ordering, counts, labels, search, and scheduling. Prefer applying the canonical response over triggering global invalidation. Browser optimistic updates complement server controls. Route each action through the shared API client. Keep temporary IDs, drafts, and cached data in memory. In the browser, the adapter in `apps/web/src/browser/` commits each command to IndexedDB and writes the account queue in the same transaction. Preserve account isolation, cleanup on sign-out, and offline reopening. [Browser workspaces](docs/06-browser-local-first-implementation.md#implementa%C3%A7%C3%A3o).
- Use the vocabulary of existing screens and the date helpers. Treat due dates as civil dates in `YYYY-MM-DD` format, times as local times, and completion as an instant. Use `referenceDate` and the account's time zone when a rule depends on Today, overdue tasks, or recurrence. [Motion and interaction](docs/04-motion-and-interaction.md) · [Brand](docs/05-brand.md)

## API, data, and security

- Keep Route Handlers thin. Validate bodies, parameters, and queries with Zod schemas, use the helpers in `apps/web/src/server/http/` for authentication, origin checks, and errors, and keep business rules in services. Mark sensitive modules with `server-only`.
- In private routes, derive the tenant from the validated session. Use the transaction created by `withTenant` for domain queries and preserve RLS isolation. Resources belonging to another tenant must behave as if absent. For public sharing, use the token-based flow and expose only the fields allowed by the public DTO.
- Preserve `Origin` validation on private routes using write methods, temporary-password restrictions, secure cookies, and `Cache-Control: private, no-store` on API responses. Use explicit DTOs and keep search text and other personal data out of URLs and logs.
- Make related changes in the same transaction. Check entity `revision` when required by the contract and advance `productRevision` in the transaction of any write that changes product projections. Account for concurrency, rollback, and repeated requests. Preserve idempotency in flows that already provide it, such as recurring-task completion and imports.
- Preserve envelope encryption, per-account key isolation, payload integrity checks, and key usage budgets. Use the existing read, write, and rotation functions. For schema or privilege changes, use `pnpm db:generate` to add a migration in `apps/web/drizzle/`. Validate both fresh installations and upgrades where applicable, using the actual runtime roles and minimum privileges.
- Keep secrets and personal data out of Git, bundles, logs, and metrics. Store environment files and keys in private directories outside the checkout. Separate domain, authentication, migration, and administration credentials. [Architecture and isolation](docs/01-architecture-and-stack.md) · [HTTP contract](docs/02-backend-endpoints.md)

## Reads and performance

- Start with bounded queries, the DTOs needed by the screen, and existing pagination. Measure cold and warm reads before expanding the cache or adding infrastructure. Consider record volume, queries, decryption, and retained memory.
- The product cache lives in RAM per process. It stores navigation summaries, active projects, archived projects, and labels on demand. Explicit single-process mode also covers Today, Upcoming, and project pages. Preserve retention of up to 12 hours, per-entry and per-process limits, authorization before reads, and separation by tenant, projection, and parameters. Keep task descriptions, including excerpts, sessions, and keys out of the cache.
- In default mode, cacheable reads check `productRevision` on the primary PostgreSQL instance using the same snapshot used to rebuild the projection. In single-process mode, commits that advance the revision invalidate the account's cache. Preserve day rollover in the account's time zone for projections using the reference date. When changing the cache, test expiration, isolation, concurrent commits, and reads from different instances. [Cache and measurements](docs/03-operations.md#cache-interno-de-leituras-do-produto)

## Development and operations

- Install dependencies from the root with `pnpm install --frozen-lockfile`. Use `pnpm dev:desktop` for the desktop app. For local development, use `compose.dev.yaml` or `pnpm dev` with HTTPS and `FEITO_ORIGIN` matching the origin accessed by the browser. `scripts/new-env.sh` generates a private environment file.
- Production uses the Next.js standalone output. `compose.prod.yaml` uses Caddy and an internal PostgreSQL instance. `compose.prod.tunnel.yaml` uses external PostgreSQL with verified TLS, and `cloudflared` forwards to `http://app:3000` on the Compose network. Migrations run before the app. Use `GET /api/health` to check installation health.
- Use a disposable database and dedicated credentials for development and tests. `compose.yaml` starts only PostgreSQL. Consult the backup, restore, and rotation documentation before changes affecting existing installations. [Installation](apps/web/README.md) · [Operations and maintenance](docs/03-operations.md)

## CI and distribution

- For every Feito version bump, advance web and desktop together to the same `X.Y.Z`; never update only one app. Update `apps/web/package.json` and `apps/desktop/src-tauri/tauri.conf.json`, keep `apps/desktop/package.json` aligned, and confirm that the release tag `vX.Y.Z` matches the versions declared in all three files.
- The [web workflow](.github/workflows/web.yml) checks types, builds, Compose, unit and integration tests with PostgreSQL 18, and Playwright over HTTPS. It publishes web and tooling images to GHCR after checks pass. Pushes to `main` and `dev` use the `latest` and `dev` image tags, respectively. Pushes of `vX.Y.Z` tags publish images with version `X.Y.Z`.
- The [desktop workflow](.github/workflows/desktop.yml) checks TypeScript and Rust across six targets. Pushes of `vX.Y.Z` tags and manual runs generate all 11 installers and store them in run artifacts. These tag pushes also publish the installers to GitHub Releases after the matrix passes. [Installer matrix](apps/desktop/README.md#ci-and-releases)
- Both workflows check pull requests and pushes to `main` and `dev`, including changes to shared packages. For an official release, both use the same tag, which must match the version in `apps/desktop/src-tauri/tauri.conf.json`. [Release instructions](docs/03-operations.md#releases)

## Tests

- When fixing a bug, add a regression test at the layer that reproduces the incorrect behavior and confirm the fix.
- For meaningful changes, run tests directly related to the changed behavior before finishing. Include other layers when affected. If adequate coverage is missing, add a test where possible.
- Use synthetic data and the disposable integration PostgreSQL instance. In concurrency tests, control the order of operations. In Playwright, prefer semantic selectors and assertions about observable state over fixed waits.
- In the handoff, report which checks passed and which remain pending, with reasons. For documentation-only changes, review the diff, links, and consistency with the project's code and tools.

| Command | When to use it |
| --- | --- |
| `pnpm test` | TypeScript tests for both apps. Use `pnpm --filter @feito/web test` or `pnpm --filter @feito/desktop test` to run just one. |
| `pnpm test:integration` | HTTP contracts, isolation, persistence, concurrency, and migrations. Use disposable PostgreSQL 18 and run `pnpm db:migrate` first. |
| `pnpm test:e2e` | Web flows in Chromium, using desktop and mobile browser profiles, with a build and an HTTPS test server. [Playwright configuration](apps/web/tests/e2e/README.md) |
| `pnpm test:coverage` | Unit and integration tests with coverage, as in CI. |
| `pnpm typecheck` and `pnpm build` | Types and builds for both frontends, including generated routes and client/server boundaries. |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Desktop native core tests, run from the root. |
