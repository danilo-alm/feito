fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_workspace",
            "read_workspace_context",
            "write_workspace",
            "write_workspace_title",
            "server_request",
            "start_product_events",
            "stop_product_events",
            "open_public_project",
        ]),
    ))
    .expect("Falha ao configurar o aplicativo Tauri");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri embeds its manifest in the app binary. Integration tests that use the
        // mock window also need Common Controls v6 when Windows loads the executable.
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/windows-app.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
