use super::*;

#[test]
fn catalog_has_unique_ids_and_license_metadata() {
    let mut ids = std::collections::HashSet::new();
    for spec in MODELS {
        assert!(ids.insert(spec.id), "id duplicado: {}", spec.id);
        assert!(!spec.dir_name.is_empty());
        assert!(!spec.license.id.is_empty());
        assert!(spec.license.url.starts_with("https://"));
        assert!(!spec.files.is_empty());
        for file in spec.files {
            assert!(!file.file_name.is_empty());
            assert!(file.url.starts_with("https://"));
            assert_eq!(file.sha256.len(), 64);
            assert!(file.bytes > 0);
        }
    }
}

#[test]
fn model_by_id_resolves_known_and_rejects_unknown() {
    assert_eq!(model_by_id("u2netp").map(|s| s.id), Some("u2netp"));
    assert!(model_by_id("no-existe").is_none());
}

#[test]
fn pending_files_reports_missing_and_short_files() {
    let dir = std::env::temp_dir().join(format!("olyvia-models-{}", uuid::Uuid::new_v4()));
    let spec = model_by_id("u2netp").expect("spec");
    assert_eq!(pending_files(&dir, spec).len(), spec.files.len());
    let model = model_dir(&dir, spec);
    std::fs::create_dir_all(&model).expect("mkdir");
    std::fs::write(model.join(spec.files[0].file_name), b"corto").expect("write");
    assert_eq!(pending_files(&dir, spec).len(), spec.files.len());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn splits_archive_urls_from_direct_urls() {
    assert_eq!(
        split_archive_url("https://cdn/model.zip#carpeta/pesos.onnx"),
        ("https://cdn/model.zip", Some("carpeta/pesos.onnx"))
    );
    assert_eq!(
        split_archive_url("https://cdn/model.onnx"),
        ("https://cdn/model.onnx", None)
    );
    assert_eq!(
        split_archive_url("https://cdn/model.zip#"),
        ("https://cdn/model.zip", None)
    );
    assert_eq!(
        split_archive_url("https://cdn/model.zip#   "),
        ("https://cdn/model.zip", None)
    );
}

#[test]
fn zip_cache_path_is_stable_and_unique_per_url() {
    let dir = Path::new("cache");
    let a = zip_cache_path(dir, "https://cdn/a.zip");
    let b = zip_cache_path(dir, "https://cdn/a.zip");
    let c = zip_cache_path(dir, "https://cdn/b.zip");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(a.to_string_lossy().contains(".archive-"));
}

#[test]
fn resolves_zip_entries_by_path_or_basename() {
    let dir = std::env::temp_dir().join(format!("olyvia-zip-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp");
    let zip_path = dir.join("modelo.zip");
    {
        let file = std::fs::File::create(&zip_path).expect("zip");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "carpeta/pesos.onnx",
                zip::write::SimpleFileOptions::default(),
            )
            .expect("entrada");
        writer.write_all(b"modelo").expect("contenido");
        writer.finish().expect("cerrar");
    }
    let mut archive =
        zip::ZipArchive::new(std::fs::File::open(&zip_path).expect("abrir")).expect("zip");
    assert_eq!(
        resolve_zip_entry(&mut archive, "carpeta/pesos.onnx").expect("ruta exacta"),
        "carpeta/pesos.onnx"
    );
    assert_eq!(
        resolve_zip_entry(&mut archive, "pesos.onnx").expect("basename"),
        "carpeta/pesos.onnx"
    );
    assert!(resolve_zip_entry(&mut archive, "otro.onnx").is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

/// Descarga real del modelo con pesos externos (62 MB) y verifica que el
/// ZIP se extraiga y que ambos archivos coincidan con su checksum.
#[test]
#[ignore = "descarga real de 62 MB; requiere red y EDITOR_IA_RUN_RENDER_TESTS=1"]
fn live_downloads_real_esrgan_zip_files() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la descarga real");
        return;
    }
    let spec = model_by_id("real-esrgan-x4plus").expect("spec");
    let dir = std::env::temp_dir().join(format!("olyvia-esrgan-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp");
    let total = total_bytes(spec);
    let mut done = 0u64;
    let mut archives = Vec::new();
    for file in spec.files {
        let target = dir.join(file.file_name);
        let (base_url, _) = split_archive_url(file.url);
        download_file_verified(
            file,
            &target,
            &dir,
            &mut archives,
            &mut done,
            total,
            archive_byte_cap(spec.files, base_url),
            &mut |_| {},
        )
        .expect("descarga verificada");
        let meta = std::fs::metadata(&target).expect("archivo");
        assert_eq!(meta.len(), file.bytes);
        let mut hasher = Sha256::new();
        let mut handle = std::fs::File::open(&target).expect("abrir");
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = handle.read(&mut buffer).expect("leer");
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        assert_eq!(format!("{:x}", hasher.finalize()), file.sha256);
    }
    for archive in archives {
        let _ = std::fs::remove_file(archive);
    }
    let _ = std::fs::remove_dir_all(&dir);
    eprintln!("real-esrgan verificado: {done} bytes extraídos del ZIP");
}

/// AUD-088: la descarga aborta apenas el stream supera el tope de bytes
/// esperado, sin escribir el resto del cuerpo en disco.
#[test]
fn stream_download_aborts_over_the_byte_cap() {
    use std::io::Write as _;
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            let _ = std::io::Read::read(&mut stream, &mut buf);
            let body = vec![b'x'; 200_000];
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    let url = format!("http://127.0.0.1:{port}/model.bin");
    let mut written = 0u64;
    let result = stream_download(&url, 1024, |chunk| {
        written += chunk.len() as u64;
        Ok(())
    });
    let error = result.expect_err("debió abortar por tamaño");
    assert_eq!(error.code, ProjectErrorCode::FileTooLarge);
    // El buffer es de 64 KiB: se aborta en el primer chunk que pasa el tope.
    assert!(
        written <= 128 * 1024,
        "escribió {written} bytes antes de abortar"
    );
}

/// AUD-088: una entrada ZIP que descomprime más de lo esperado aborta la
/// extracción apenas lo supera y no deja el `.partial` en disco.
#[test]
fn zip_entry_over_expected_size_aborts_and_cleans_partial() {
    let dir = std::env::temp_dir().join(format!("olyvia-models-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp");
    let base_url = "https://example.test/pkg.zip";
    // Se siembra la caché del ZIP: ensure_archive la reutiliza sin red.
    let cache = zip_cache_path(&dir, base_url);
    {
        let file = std::fs::File::create(&cache).expect("zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("grande.bin", options).expect("entry");
        std::io::copy(&mut std::io::repeat(0u8).take(200_000), &mut zip).expect("write");
        zip.finish().expect("finish");
    }
    let spec_file = ModelFileSpec {
        file_name: "grande.bin",
        url: "https://example.test/pkg.zip#grande.bin",
        sha256: "00",
        bytes: 1024,
    };
    let target = dir.join("grande.bin");
    let mut archives = Vec::new();
    let mut done = 0u64;
    let result = download_file_verified(
        &spec_file,
        &target,
        &dir,
        &mut archives,
        &mut done,
        2048,
        archive_byte_cap(&[spec_file], base_url),
        &mut |_| {},
    );
    let error = result.expect_err("debió abortar por tamaño");
    assert_eq!(error.code, ProjectErrorCode::FileTooLarge);
    assert!(!target.with_extension("bin.partial").exists());
    for archive in archives {
        let _ = std::fs::remove_file(archive);
    }
    let _ = std::fs::remove_dir_all(&dir);
}
