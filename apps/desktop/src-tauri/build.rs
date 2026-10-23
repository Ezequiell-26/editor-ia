fn main() {
    tauri_build::build();
    if let Some(out_dir) = std::env::var_os("OUT_DIR") {
        let out_dir = std::path::Path::new(&out_dir);
        // `tauri-build` adjunta el manifiesto (comctl32 v6) y los iconos a los
        // binarios con `rustc-link-arg-bins`, pero no a los ejecutables de test.
        // Sin ese recurso Windows carga comctl32 v5 y el proceso muere antes de
        // correr un test con STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) al resolver
        // `TaskDialogIndirect`, que importa el backend de diálogos.
        // El wrapper `scripts/rust-env.mjs` marca las corridas de `cargo test`.
        // En ese caso el ejecutable de test también necesita el manifiesto;
        // `rustc-link-arg-bins` de tauri-build no llega a los tests de lib.
        println!("cargo:rerun-if-env-changed=EDITOR_IA_TEST_BUILD");
        let test_build = std::env::var_os("EDITOR_IA_TEST_BUILD").is_some();
        let resource = out_dir.join("resource.lib");
        if test_build && resource.is_file() {
            println!("cargo:rustc-link-arg={}", resource.display());
        }

        // ONNX Runtime se carga dinámicamente: durante el desarrollo y los tests
        // el ejecutable vive en target/<perfil>/, así que el DLL tiene que estar
        // ahí. En la app instalada lo resuelve el bundler (resources).
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/onnxruntime/onnxruntime.dll");
        if source.is_file() {
            // OUT_DIR = target/<perfil>/build/<pkg>/out → tres niveles arriba es
            // target/<perfil>/.
            let profile_dir = out_dir.ancestors().nth(3).map(std::path::Path::to_path_buf);
            if let Some(profile_dir) = profile_dir {
                let destination = profile_dir.join("onnxruntime.dll");
                if !destination.exists() {
                    let _ = std::fs::copy(&source, &destination);
                }
            }
        }
    }
}
