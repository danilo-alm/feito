fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_workspace",
            "write_workspace",
            "server_request",
            "start_product_events",
            "stop_product_events",
            "open_public_project",
        ]),
    ))
    .expect("Falha ao configurar o aplicativo Tauri");
}
