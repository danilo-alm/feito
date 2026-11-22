#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server;
mod workspace;

use tauri::{webview::NewWindowResponse, Manager, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            let service = app.config().identifier.clone();
            let store = workspace::WorkspaceStore::new(directory, service.clone());
            app.manage(store.clone());
            app.manage(server::ServerSessions::new(service, store));

            let window = &app.config().app.windows[0];
            WebviewWindowBuilder::from_config(app, window)?
                .on_navigation(|url| {
                    matches!(
                        (url.scheme(), url.host_str(), url.port()),
                        ("tauri", Some("localhost"), None)
                            | ("http", Some("tauri.localhost"), None)
                    ) || (cfg!(dev)
                        && url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420))
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::read_workspace,
            workspace::read_workspace_context,
            workspace::write_workspace,
            workspace::write_workspace_title,
            server::start_product_events,
            server::stop_product_events,
            server::open_public_project,
            server::server_request
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar o Feito");
}
