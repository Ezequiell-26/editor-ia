use super::*;

#[test]
fn fs_list_shows_dirs_first_and_classifies_kinds() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-list-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("clip.mp4"), b"x").unwrap();
    std::fs::write(root.join("notas.srt"), b"x").unwrap();
    std::fs::write(root.join("raro.bin"), b"x").unwrap();

    let listing = fs_list(root.to_string_lossy().into_owned()).unwrap();
    assert_eq!(listing.entries[0].kind, "dir");
    assert_eq!(listing.entries[0].name, "sub");
    let kinds: Vec<&str> = listing
        .entries
        .iter()
        .filter(|entry| entry.kind != "dir")
        .map(|entry| entry.kind.as_str())
        .collect();
    assert!(kinds.contains(&"video"));
    assert!(kinds.contains(&"subtitle"));
    assert!(kinds.contains(&"other"));
    assert!(!listing.truncated);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn fs_list_rejects_missing_path() {
    assert!(fs_list("C:\\no\\existe\\carpeta".to_owned()).is_err());
}

#[test]
fn fs_read_returns_text_and_marks_truncation() {
    let file = std::env::temp_dir().join(format!("olyvia-fs-read-{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&file, "hola mundo").unwrap();
    let content = fs_read(file.to_string_lossy().into_owned()).unwrap();
    assert_eq!(content.content, "hola mundo");
    assert!(!content.truncated);
    assert!(fs_read(file.to_string_lossy().into_owned()).is_ok());
    let _ = std::fs::remove_file(&file);

    let big = std::env::temp_dir().join(format!("olyvia-fs-big-{}.txt", uuid::Uuid::new_v4()));
    let payload = vec![b'a'; (FS_READ_MAX_BYTES + 10) as usize];
    std::fs::write(&big, &payload).unwrap();
    let big_content = fs_read(big.to_string_lossy().into_owned()).unwrap();
    assert!(big_content.truncated);
    assert_eq!(big_content.content.len() as u64, FS_READ_MAX_BYTES);
    let _ = std::fs::remove_file(&big);
}

#[test]
fn fs_read_rejects_directories() {
    let dir = std::env::temp_dir().join(format!("olyvia-fs-dir-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(fs_read(dir.to_string_lossy().into_owned()).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fs_write_creates_parents_and_overwrites() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-write-{}", uuid::Uuid::new_v4()));
    let file = root.join("sub").join("guion.txt");
    let result = fs_write(
        file.to_string_lossy().into_owned(),
        "línea 1\nlínea 2".to_owned(),
    )
    .unwrap();
    assert!(result.bytes > 0);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "línea 1\nlínea 2");
    fs_write(file.to_string_lossy().into_owned(), "nuevo".to_owned()).unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "nuevo");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn fs_write_rejects_empty_path_and_oversized_content() {
    assert!(fs_write("   ".to_owned(), "x".to_owned()).is_err());
    let big = "x".repeat(FS_WRITE_MAX_BYTES + 1);
    assert!(fs_write(
        std::env::temp_dir()
            .join(format!("olyvia-fs-big-{}.txt", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned(),
        big
    )
    .is_err());
}

#[test]
fn fs_mkdir_creates_nested_and_fs_delete_respects_recursive() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-del-{}", uuid::Uuid::new_v4()));
    let nested = root.join("a").join("b");
    fs_mkdir(nested.to_string_lossy().into_owned(), None).unwrap();
    assert!(nested.is_dir());
    // Carpeta no vacía sin recursive debe fallar.
    std::fs::write(nested.join("f.txt"), "x").unwrap();
    assert!(fs_delete(root.to_string_lossy().into_owned(), None).is_err());
    let removed = fs_delete(root.to_string_lossy().into_owned(), Some(true)).unwrap();
    assert!(removed.recursive);
    assert!(!root.exists());
}

#[test]
fn fs_delete_rejects_protected_paths_and_missing() {
    assert!(fs_delete("C:\\".to_owned(), None).is_err());
    assert!(fs_delete("C:\\Windows".to_owned(), Some(true)).is_err());
    assert!(fs_delete("C:\\no\\existe\\archivo-xyz.txt".to_owned(), None).is_err());
}

#[test]
fn fs_write_mkdir_reject_system_dirs() {
    let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
    assert!(fs_write(
        Path::new(&windows)
            .join("editoria-test.txt")
            .to_string_lossy()
            .into_owned(),
        "x".to_owned()
    )
    .is_err());
    assert!(fs_mkdir(
        Path::new(&windows)
            .join("editoria-test-dir")
            .to_string_lossy()
            .into_owned(),
        None
    )
    .is_err());
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_owned());
    assert!(fs_write(
        Path::new(&program_files)
            .join("editoria-test.txt")
            .to_string_lossy()
            .into_owned(),
        "x".to_owned()
    )
    .is_err());
    // El perfil del usuario y Temp siguen siendo escribibles.
    let ok = fs_write(
        std::env::temp_dir()
            .join(format!("olyvia-fs-sys-{}.txt", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned(),
        "ok".to_owned(),
    )
    .unwrap();
    assert!(ok.bytes > 0);
}

#[test]
fn fs_delete_rejects_user_profile_root_and_fs_move_protects_source() {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        // Borrar el perfil completo está prohibido (sólo la raíz; las
        // subcarpetas del perfil sí se pueden gestionar).
        assert!(fs_delete(profile.clone(), Some(true)).is_err());
    }
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
    let source = Path::new(&system).join("editoria-move-test.txt");
    // Aunque el origen no exista, la protección salta antes que el exists.
    assert!(fs_move(
        source.to_string_lossy().into_owned(),
        std::env::temp_dir()
            .join("editoria-move-out.txt")
            .to_string_lossy()
            .into_owned(),
    )
    .is_err());
}

#[test]
fn fs_move_renames_and_relocates() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-move-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let from = root.join("viejo.txt");
    let to = root.join("nuevo").join("renombrado.txt");
    std::fs::write(&from, "datos").unwrap();
    let moved = fs_move(
        from.to_string_lossy().into_owned(),
        to.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert!(!from.exists());
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "datos");
    assert_eq!(moved.path, to.to_string_lossy());
    // Destino existente falla.
    assert!(fs_move(
        to.to_string_lossy().into_owned(),
        root.join("otro.txt").to_string_lossy().into_owned(),
    )
    .is_ok());
    assert!(fs_move(
        to.to_string_lossy().into_owned(),
        root.join("otro.txt").to_string_lossy().into_owned(),
    )
    .is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn normalized_components_resolves_dotdot() {
    let p = normalized_components(Path::new("C:\\foo\\bar\\..\\..\\Windows\\System32"));
    assert_eq!(path_key(&p), "c:\\windows\\system32");
    // `..` en la raíz no escapa de la unidad.
    let p = normalized_components(Path::new("C:\\..\\Windows"));
    assert_eq!(path_key(&p), "c:\\windows");
}

#[test]
fn resolved_for_check_canonicaliza_y_reacopla_faltantes() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-resolve-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    // Archivo inexistente dentro de carpeta existente: el ancestro se
    // canonicaliza y el segmento faltante se re-acopla.
    let deep = root.join("a").join("b").join("c.txt");
    let resolved = resolved_for_check(&deep);
    assert!(
        resolved.to_string_lossy().ends_with("a\\b\\c.txt")
            || resolved.to_string_lossy().ends_with("a/b/c.txt")
    );
    // Sin prefijo \\?\ verbatim: las comparaciones de texto asumen rutas
    // normales de Windows.
    assert!(!resolved.to_string_lossy().starts_with(r"\\?\"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn fs_commands_rejectan_rutas_sensibles() {
    let root = std::env::temp_dir().join(format!("olyvia-fs-sens-{}", uuid::Uuid::new_v4()));
    let ssh = root.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    let key = ssh.join("id_rsa");
    std::fs::write(&key, "CLAVE-FALSA").unwrap();
    let key_str = key.to_string_lossy().into_owned();
    // Lectura, listado, escritura, borrado y movimiento: todos
    // bloqueados aunque el archivo exista y sea del propio usuario.
    assert!(fs_read(key_str.clone()).is_err());
    assert!(fs_list(ssh.to_string_lossy().into_owned()).is_err());
    assert!(fs_write(
        ssh.join("authorized_keys").to_string_lossy().into_owned(),
        "ssh-rsa AAAA".to_owned(),
    )
    .is_err());
    assert!(fs_delete(key_str.clone(), None).is_err());
    assert!(fs_move(
        key_str.clone(),
        root.join("movida.txt").to_string_lossy().into_owned(),
    )
    .is_err());
    // Y no se puede bypassear moviendo primero a una ruta inocente:
    // el destino también se chequea.
    assert!(fs_move(
        root.join("normal.txt").to_string_lossy().into_owned(),
        ssh.join("normal.txt").to_string_lossy().into_owned(),
    )
    .is_err());
    // Una ruta normal del mismo árbol sigue funcionando.
    std::fs::write(root.join("normal.txt"), "ok").unwrap();
    assert!(fs_read(root.join("normal.txt").to_string_lossy().into_owned()).is_ok());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn user_file_path_exige_absoluta_y_rechaza_credenciales() {
    // Vacía o relativa: la política de archivos sueltos exige absoluta —
    // una relativa se resolvería contra el cwd del proceso, ambiguo.
    assert!(resolve_user_file_path("").is_err());
    assert!(resolve_user_file_path("   ").is_err());
    assert!(resolve_user_file_path("clip.mp4").is_err());
    assert!(resolve_user_file_path("media\\clip.mp4").is_err());

    let root = std::env::temp_dir().join(format!("olyvia-userpath-{}", uuid::Uuid::new_v4()));
    let ssh = root.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    let key = ssh.join("id_rsa");
    std::fs::write(&key, "CLAVE-FALSA").unwrap();
    // Dentro de una carpeta de credenciales: rechazada aunque el archivo
    // exista y sea del propio usuario.
    assert!(resolve_user_file_path(&key.to_string_lossy()).is_err());
    // Y no se evade con `..`: el traversal normaliza antes de chequear.
    let traversal = root.join("sub").join("..").join(".ssh").join("id_rsa");
    assert!(resolve_user_file_path(&traversal.to_string_lossy()).is_err());
    // Archivo de secreto de la app por nombre, en cualquier carpeta.
    let token = root.join("downloader-bridge.token");
    std::fs::write(&token, "tok").unwrap();
    assert!(resolve_user_file_path(&token.to_string_lossy()).is_err());
    // Un archivo normal del usuario pasa y vuelve resuelto y absoluto.
    let media = root.join("clip.mp4");
    std::fs::write(&media, b"x").unwrap();
    let resolved = resolve_user_file_path(&media.to_string_lossy()).unwrap();
    assert!(resolved.is_absolute());
    assert!(resolved.is_file());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn user_write_path_rechaza_sistema_credenciales_y_carpeta_de_la_app() {
    assert!(validate_user_write_path("").is_err());
    assert!(validate_user_write_path("salida\\video.mp4").is_err());
    let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
    assert!(validate_user_write_path(&format!("{windows}\\editoria-test.txt")).is_err());
    let root = std::env::temp_dir().join(format!("olyvia-userwrite-{}", uuid::Uuid::new_v4()));
    let ssh = root.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    assert!(validate_user_write_path(&ssh.join("authorized_keys").to_string_lossy()).is_err());
    // La carpeta de datos de la app está vedada para escritura por IPC.
    if let Ok(appdata) = std::env::var("APPDATA") {
        let owned = Path::new(&appdata)
            .join("com.editoria.desktop")
            .join("salida.mp4");
        assert!(validate_user_write_path(&owned.to_string_lossy()).is_err());
    }
    // Una carpeta temporal normal pasa.
    let ok = validate_user_write_path(
        &std::env::temp_dir()
            .join(format!("olyvia-userwrite-ok-{}.mp4", uuid::Uuid::new_v4()))
            .to_string_lossy(),
    )
    .unwrap();
    assert!(ok.is_absolute());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn system_dir_check_blocks_dotdot_traversal() {
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
    let leaf = Path::new(&system)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Windows".to_owned());
    // `C:\cualquiera\..\Windows\x` normaliza a `C:\Windows\x`: sin la
    // normalización el prefijo `c:\windows\` no matcheaba y se podía
    // escribir/borrar dentro de carpetas de sistema.
    let traversal = format!("C:\\no-existe\\..\\{}\\editoria-traversal-test.txt", leaf);
    assert!(inside_system_dir(Path::new(&traversal)));
    assert!(fs_write(traversal.clone(), "x".to_owned()).is_err());
    assert!(fs_delete(traversal, None).is_err());
    assert!(fs_mkdir(
        format!("C:\\no-existe\\..\\{}\\editoria-traversal-dir", leaf),
        None,
    )
    .is_err());
}
