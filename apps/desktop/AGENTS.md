# Agent guidelines for Feito desktop

**English** | [Português (Brasil)](AGENTS.pt-br.md)

## Project

Feito desktop is Feito's personal task app for macOS, Windows, and Linux. It packages the website's React interface with Vite and Tauri. Users can use a local workspace without an account or link remote workspaces to Feito installations over HTTPS. Each workspace has its own data. The desktop app syncs the active remote workspace and keeps the other queues on the computer.

The desktop app lives in `apps/desktop` in the monorepo. It uses [@feito/ui](../../packages/ui) and [@feito/core](../../packages/core) through the pnpm workspace. See the [root AGENTS.md](../../AGENTS.md) for the web app and shared packages. Check the branch and sync API availability before validating integration.

Use **Node.js 24**, **pnpm 10**, and **stable Rust**. See [package.json](package.json), [pnpm-lock.yaml](../../pnpm-lock.yaml), and [Cargo.lock](src-tauri/Cargo.lock) for the versions in use. The packaged app includes local assets. Local mode works without a server connection.

## Where to work

| Area | Path |
| --- | --- |
| Desktop entry point, navigation, and styles | [main.tsx](src/main.tsx), [src/platform/](src/platform/), [desktop.css](src/desktop.css) |
| Settings and workspace management | [settings.tsx](src/settings.tsx), [spaces.tsx](src/spaces.tsx) |
| Local-mode commands and projections | [Shared executor](../../packages/core/src/product/local-executor.ts), [local projections](../../packages/core/src/product/local-workspace.ts) |
| Workspace state, queue, and sync | [desktop.ts](src/data/desktop.ts), [native.ts](src/data/native.ts), [shared replica](../../packages/core/src/product/replica.ts) |
| Window, capabilities, and Tauri configuration | [main.rs](src-tauri/src/main.rs), [desktop.json](src-tauri/capabilities/desktop.json), [tauri.conf.json](src-tauri/tauri.conf.json) |
| SQLite database, encryption, and HTTPS transport | [workspace.rs](src-tauri/src/workspace.rs), [server.rs](src-tauri/src/server.rs) |
| Tests, automation, and distribution | [local.test.ts](src/data/local.test.ts), [desktop.test.ts](src/data/desktop.test.ts), [desktop.yml](../../.github/workflows/desktop.yml) |

- Before editing, trace behavior from the screen through the adapters, Rust commands, web API, and affected tests. Check the root, branch, and existing changes in the monorepo checkout.
- Reuse components and rules from the shared packages. Change the web app when there is a concrete integration need and preserve current contracts.
- Preserve data already stored in SQLite. Handle new fields, pending operations, and version upgrades in accordance with previous formats.

## Frontend and workspaces

- Use the tokens, common components, and motion rules from `packages/ui`. Preserve focus, keyboard support, accessible labels, and reduced motion. Check interface changes in the Tauri WebView and at widths suitable for narrow windows.
- Route product commands through the shared client and local adapter. Reuse shared validation, types, and projections. Preserve static bundle boundaries when importing modules also used by the server.
- Show the workspace in use, linked addresses, queued action count, and sync states that require attention. Confirm deletion of the local workspace and preserve remote workspaces and their queues. After deletion, allow users to create a new local workspace or open a remote workspace.
- Keep Feito's date semantics. Due dates are civil dates, times are local times, and completion is an instant. Use the workspace's time zone for scheduling and recurrence.

## Persistence, sync, and security

- Save the change and its corresponding queue together, through the same persistence command. Preserve SQLite generation tracking, document integrity validation, and key protection in the system vault.
- Separate data and operations by workspace, HTTPS origin, and linked account. Check remote identity before sending the queue. Session expiration, workspace switching, or server unavailability must preserve pending operations.
- Preserve operation IDs, authoring timestamps, and IDs of created entities when resending. Use server acknowledgments to remove operations from the queue. Apply the received baseline or changes together with the cursor and reconcile still-pending actions. Test lost responses and out-of-order revisions.
- Preserve the latest-edit-wins rule for fields where the server applies it, revision checks for structural changes, and per-occurrence idempotency for recurring tasks. A late edit must not recreate a deleted item.
- Use authorized IPC commands for storage and transport. Preserve window scope, TLS validation, redirect blocking, and restriction to Feito API routes. Keep only the data key in the system vault, and the session cookie encrypted with that key in SQLite, so the system asks for vault access once. Do not add vault items per origin. Avoid logging credentials, authentication headers, or task data.

## Development and operations

- Install dependencies with `pnpm install --frozen-lockfile` from the monorepo root. Use `pnpm dev:desktop` from the root or `pnpm tauri dev` in `apps/desktop` to start the native window with Vite.
- To validate real sync, use an HTTPS test installation with the desktop API, applied migrations, and disposable credentials. Use an isolated Tauri profile to avoid mixing validation data with personal workspaces. Consult the HTTP contract and operating instructions in the [docs](../../docs) folder.
- The [desktop workflow](../../.github/workflows/desktop.yml) uses the monorepo checkout. For each target, it runs typecheck, TypeScript tests, the frontend build, Rust formatting, and Rust tests. Pushes of `vX.Y.Z` tags and manual runs also package with Tauri and store installers in GitHub Actions `Artifacts`. Pushing the shared `vX.Y.Z` tag matching the version in `src-tauri/tauri.conf.json` publishes the release after the full matrix generates all 11 installers. Create tags, publish releases, or change distribution credentials only when requested. [Matrix and release instructions](README.md#ci-and-releases)

## Tests

Run the commands below in `apps/desktop`.

- TypeScript tests use a simulated bridge for local mode and sync. Rust tests cover native persistence and transport. To check the app's interface, open the Tauri window. Web Playwright tests use Chromium.
- For fixes, add a regression test at the layer that reproduces the problem. Use synthetic data. When changing local mode, check saving and reopening. When changing sync, check interruption, resumption, resending, workspace isolation, and website updates.
- Run checks related to the change. When a web contract changes, also validate the relevant integration tests against the website's disposable PostgreSQL instance. In the handoff, record what passed and what remains pending, with reasons. For documentation, review the diff, links, and referenced commands.

| Command | When to use it |
| --- | --- |
| `pnpm typecheck` and `pnpm build` | Types, aliases, shared dependencies, and static bundle. |
| `pnpm test` | Local rules, workspace state, and sync with a simulated bridge. |
| `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | Rust code formatting. |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Persistence, encryption, and native transport contracts. |
| `pnpm tauri build --debug --no-bundle` | Native compilation without packaging, on the available platform. |
| `pnpm tauri build` | Packaging on the target platform. |
