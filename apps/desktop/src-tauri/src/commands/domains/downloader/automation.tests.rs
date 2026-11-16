use super::*;

#[test]
fn extracts_urls_from_watch_text() {
    let urls = extract_urls(
        "# lista\nhttps://youtu.be/uno\n\n  https://example.com/dos, \nno es url\nhttps://youtu.be/uno\n",
    );
    assert_eq!(
        urls,
        vec!["https://youtu.be/uno", "https://example.com/dos"]
    );
    assert!(extract_urls("solo texto").is_empty());
}

#[test]
fn parses_rss_and_atom_entries() {
    let rss = r#"<?xml version="1.0"?><rss><channel>
        <item><title>Primero</title><link>https://example.com/a</link><pubDate>Mon, 01 Jan 2026</pubDate></item>
        <item><title>Segundo</title><link>https://example.com/b</link></item>
    </channel></rss>"#;
    let items = parse_feed(rss, 10);
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].title, "Primero");
    assert_eq!(items[0].link, "https://example.com/a");
    assert_eq!(items[1].published, None);

    let atom = r#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
        <entry><title>Atom</title><link href="https://example.com/atom"/><updated>2026-01-01T00:00:00Z</updated></entry>
    </feed>"#;
    let items = parse_feed(atom, 10);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].link, "https://example.com/atom");
    assert_eq!(items[0].published.as_deref(), Some("2026-01-01T00:00:00Z"));
}

#[test]
fn watch_folder_requires_a_directory() {
    assert!(scan_watch_folder("Z:\\no-existe".to_owned()).is_err());
    assert!(scan_watch_folder(String::new()).is_err());
}

#[test]
fn watch_folder_reads_txt_lists_and_skips_empty_files() {
    let root = std::env::temp_dir().join(format!("editoria-watch-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("lista.txt"),
        "https://youtu.be/uno\n# comentario\nhttps://example.com/dos\n",
    )
    .unwrap();
    std::fs::write(root.join("vacia.txt"), "sin enlaces").unwrap();
    std::fs::write(root.join("ignorar.md"), "https://example.com/tres").unwrap();
    let files = scan_watch_folder(root.to_string_lossy().into_owned()).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].name, "lista.txt");
    assert_eq!(files[0].urls.len(), 2);
    assert!(files[0].modified_seconds > 0);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn checksum_headers_convert_base64_to_hex() {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "content-md5",
        reqwest::header::HeaderValue::from_static("kAFQmDzST7DWlj99KOF/cg=="),
    );
    headers.insert(
        "digest",
        reqwest::header::HeaderValue::from_static(
            "sha-256=:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=:",
        ),
    );
    let checksum = checksum_from_headers(&headers);
    assert_eq!(
        checksum.md5.as_deref(),
        Some("900150983cd24fb0d6963f7d28e17f72")
    );
    assert_eq!(
        checksum.sha256.as_deref(),
        Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    );
    assert_eq!(checksum.source, "Digest");
}

#[test]
fn rss_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    let items =
        fetch_rss_feed("https://hnrss.org/frontpage".to_owned(), Some(5)).expect("feed real");
    assert!(!items.is_empty());
    assert!(items.iter().all(|item| item.link.starts_with("http")));
    eprintln!("RSS real: {} entradas", items.len());
}
