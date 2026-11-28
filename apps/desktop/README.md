# Feito for desktop

**English** | [Português (Brasil)](README.pt-br.md)

Feito desktop uses the same interface as the website in a native window. It works without a server, with tasks stored on this computer, or syncs with a [Feito web installation](../web/README.md).

## Install

Download the installer for your platform from the [releases page](https://github.com/danilo-alm/feito/releases/latest):

| System | File |
| --- | --- |
| macOS (Intel or Apple Silicon) | `.dmg` for your architecture |
| Windows x64 | `.msi` or `-setup.exe` |
| Windows ARM64 | `-setup.exe` |
| Linux x64 or ARM64 | `.deb`, `.rpm`, or AppImage |

The installers are not yet signed for distribution:

- **macOS**: the system blocks the app on first launch. Open **System Settings → Privacy & Security** and click **Open Anyway**. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Feito.app`.
- **Windows**: in the SmartScreen warning, click **More info → Run anyway**.
- **Linux**: the app stores its encryption key in the desktop session's Secret Service, such as GNOME Keyring or KWallet.

## Usage

The interface defaults to English. Change it in **Settings → Appearance → Language**. Previously selected languages are preserved. The labels below include the Brazilian Portuguese equivalents.

Task descriptions support Markdown, including headings, lists, links, code, and tables. Click a formatted description to edit it. Formatting reappears when you leave the field. In the detail view, the field is saved when it loses focus; when creating a task or editing inline, submit the form. The same format works on the web and in local workspaces without a connection.

- Open the app to start in the **Only on this computer** (Somente neste computador) workspace. Tasks are stored in SQLCipher. The database key is derived from the key kept in the system vault. On first launch, the app copies the legacy database into a separate encrypted file.
- If the local data cannot be opened, the app says why. When the vault key is gone or does not open the database, **Start over** (Começar do zero) moves the database files into `recovery/<timestamp>` inside the app data folder, without deleting them, and creates an empty local workspace. Servers need a new sign-in; changes that were still queued stay only in the moved files. To get the old data back, quit the app, restore the original vault item and move those files back into the data folder, replacing the new ones. A locked vault, data from a newer version, or a disk error only offer **Try again** (Tentar de novo).
- In **Settings → Workspaces** (Ajustes → Espaços de trabalho), choose **Connect server** (Conectar servidor), enter the installation's HTTPS origin, and sign in with your Feito account. The installation must include the sync route and have migrations applied. The certificate must be trusted by the system; for a `localhost` installation, [import the local certificate authority](../web/README.md#a-database-in-docker). Temporary passwords must be changed on the website.
- Workspaces have independent data. Linking loads the account's data. Tasks already created in the local workspace remain accessible through Settings. Use **Connect another server** (Conectar outro servidor) to add addresses and **Open remote workspace** (Abrir espaço remoto) to switch between linked workspaces. The app syncs only the open workspace and keeps the other queues stored locally.
- **Delete local workspace** (Excluir espaço local) removes its tasks, projects, labels, and local preferences after confirmation. Remote workspaces and their queues remain available. You can create a new empty local workspace at any time.
- Changes in the synced workspace are saved locally before being sent. The server notifies the app of changes through SSE. The app also checks when it gains focus, when the network returns, and every 30 seconds if the notification channel is unavailable or syncing needs a retry. **Sync now** (Sincronizar agora) lets you retry immediately. Signing out preserves the queue and requires authentication before sending it again.
- If two edits compete for the same task field, the most recent wins, with a stable tie-breaker. Deletions take precedence over late edits. Operations that no longer apply are reported in Settings. A rejection blocking the queue can be discarded after confirmation. Structural changes to projects, sections, and labels still follow the revisions used by the website.
- In a synced project, **Share** (Compartilhar) lets you enable or disable the linked installation's public link, copy the address, and open it in the browser. This action requires a server connection. In a local workspace, the button indicates that you need to connect to a server.
- Import and export, password changes, and task links remain available on the website.

## Development

Use Node.js 24, pnpm 10, and stable Rust. Install the Tauri prerequisites for the target platform. On Linux, credential storage requires a Secret Service available in the desktop session. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

From the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Feito Dev uses a separate profile (`app.feito.desktop.dev`) and starts with an empty workspace. Its SQLite encryption key is stored in `workspace.key` next to the database, so hot reloads and restarts can reopen it without accessing the system vault. Use test data and test accounts in this profile. Packaged builds use the system vault.

In `apps/desktop`, use `pnpm tauri build` to build the app. To validate without generating an installer, use `pnpm tauri build --debug --no-bundle`. The commands `pnpm typecheck`, `pnpm test`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` check both layers.

From the root, run `pnpm --filter @feito/web exec playwright test -c playwright.desktop.config.ts` to check opening the local workspace and using context menus with Chromium and a simulated Tauri bridge. To check production assets and on-demand screen loading, first run `pnpm --filter @feito/desktop build` and run the suite with `FEITO_DESKTOP_PREVIEW=1`. The suite covers Linux, Windows, and macOS title bars, as well as a narrow window in dark mode, and fails on unhandled JavaScript errors. The bridge is in `apps/web/tests/desktop/fixtures.ts`; when changing the native API, update this simulation too. Failure traces are stored in `apps/web/test-results/desktop/`, separate from web tests in `apps/web/test-results/web/`.

## CI and releases

GitHub Actions runs desktop checks on pull requests, pushes to `main` and `dev`, version tag pushes, and manual runs. Packaging runs on `vX.Y.Z` tag pushes and manual runs. To test packaging, open **Actions → Desktop CI and Release → Run workflow**. Installers are available as workflow run artifacts. To publish or fix assets for an existing release, run the workflow on a branch whose `tauri.conf.json` matches the release version and provide the tag in `release_tag`.

| Platform | Architecture | Packages |
| --- | --- | --- |
| Linux | x64 and ARM64 | `.deb`, `.rpm`, and AppImage |
| Windows | x64 | `.msi` and `-setup.exe` |
| Windows | ARM64 | `-setup.exe` |
| macOS | Intel and Apple Silicon | `.dmg` |

The workflow renames Windows, macOS, and AppImage files to `Feito-<version>-<system>-<architecture>`, with `x64` or `arm64` on Windows and macOS and `x86_64` or `aarch64` on Linux. For example: `Feito-1.0.0-windows-x64-setup.exe`, `Feito-1.0.0-macos-arm64.dmg`, and `Feito-1.0.0-linux-x86_64.AppImage`. `.deb` and `.rpm` packages keep Tauri's native format in lowercase, such as `feito_1.0.0_amd64.deb` and `feito-1.0.0-1.x86_64.rpm`. Publishing again to an existing release does not remove assets uploaded under other names.

Push a `vX.Y.Z` tag matching the `version` field in `src-tauri/tauri.conf.json`. The same tag publishes versioned web Docker images. [Release walkthrough](../../docs/03-operations.md#releases)

Pushing the tag publishes the GitHub release after the six targets generate all 11 installers. A manual run with `release_tag` also publishes or updates assets for an existing release. macOS packages are signed with a fixed self-signed certificate, without Apple notarization. The fixed identity lets macOS remember "Always Allow" for the Feito keychain item across updates. Generate the certificate once with `scripts/macos-signing-cert.sh` and store its output as the `MACOS_CERTIFICATE` and `MACOS_CERTIFICATE_PASSWORD` repository secrets. Without the secrets, the workflow falls back to an ad hoc signature, and macOS asks for keychain access again after every update. After the first update that changes the signing identity, macOS asks once more. Windows installers are not signed for distribution.

[Implementation guide](docs/tauri-implementation-guide.md)
