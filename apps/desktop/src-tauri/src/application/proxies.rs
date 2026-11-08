//! Casos de uso de proxies de vista previa.
//!
//! Orquesta sesión, documento del proyecto, registro de jobs, filesystem
//! del cache y eventos sin tocar Tauri ni procesos directamente. El worker
//! FFmpeg vive en `infrastructure::proxies::StdioProxyGenerator`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde_json::{json, Value};

use crate::media::proxy::{
    self, empty_status, normalized, parse_quality, pick_existing, proxy_asset_id, proxy_file_name,
    ExistingProxy, ProxyCleanupResult, ProxyStatus, DEFAULT_QUALITY, PROXY_DIR,
};
use crate::media::{probe_file, resolve_inside_root, MediaKind};
use crate::ports::media::MediaTools;
use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::ports::proxies::{ProxyEvents, ProxyFiles, ProxyGenerator, ProxyRuntime};
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Dependencias de los casos de uso de proxies.
pub struct ProxyDeps<'a> {
    pub session: &'a dyn ProjectSession,
    pub documents: &'a dyn ProjectDocuments,
    pub runtime: &'a dyn ProxyRuntime,
    pub files: &'a dyn ProxyFiles,
    pub events: &'a dyn ProxyEvents,
    pub tools: &'a dyn MediaTools,
}

struct ResolvedAsset {
    root: PathBuf,
    source: PathBuf,
    mtime_ms: u64,
    bytes: u64,
}

fn resolve_asset(deps: &ProxyDeps<'_>, asset_id: &str) -> Result<ResolvedAsset, ProjectError> {
    let session = deps.session.require()?;
    let opened = deps.documents.open(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el medio no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("").to_owned();
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo los videos pueden tener proxy de vista previa",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let source = resolve_inside_root(&session.root, relative)?;
    if !deps.files.is_file(&source) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del proxy no está en disco",
        ));
    }
    let (mtime_ms, bytes) = deps.files.fingerprint(&source).ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo leer la huella del video")
    })?;
    Ok(ResolvedAsset {
        root: session.root,
        source,
        mtime_ms,
        bytes,
    })
}

fn best_existing(
    deps: &ProxyDeps<'_>,
    asset: &ResolvedAsset,
    asset_id: &str,
) -> Option<ExistingProxy> {
    pick_existing(
        deps.files
            .candidates(&asset.root, asset_id, asset.mtime_ms, asset.bytes),
    )
}

/// Estado actual del proxy: prioriza un job en curso; si no, recalcula
/// desde el cache en disco.
pub fn current_status(deps: &ProxyDeps<'_>, asset_id: &str) -> Result<ProxyStatus, ProjectError> {
    if let Some(status) = deps.runtime.status(asset_id) {
        // Un job terminado queda en el mapa hasta el próximo status: si ya no
        // está generando, se recalcula desde el disco.
        if status.state == "queued" || status.state == "generating" {
            return Ok(status);
        }
    }
    let asset = resolve_asset(deps, asset_id)?;
    let Some(existing) = best_existing(deps, &asset, asset_id) else {
        return Ok(empty_status(asset_id));
    };
    let relative = existing
        .file
        .strip_prefix(&asset.root)
        .map(normalized)
        .unwrap_or_else(|_| normalized(&existing.file));
    let bytes = deps.files.file_len(&existing.file);
    Ok(ProxyStatus {
        asset_id: asset_id.to_owned(),
        state: "ready".to_owned(),
        quality: Some(existing.quality.clone()),
        path: Some(relative),
        exists: true,
        up_to_date: existing.up_to_date,
        width: None,
        height: None,
        bytes,
        duration_seconds: None,
        percent: 100.0,
        phase: "ready".to_owned(),
        error: None,
        source_mtime_ms: Some(asset.mtime_ms),
        updated_at_ms: proxy::now_ms(),
    })
}

/// `proxy_status(assetId)` — nunca genera.
pub fn proxy_status(deps: &ProxyDeps<'_>, asset_id: &str) -> Result<ProxyStatus, ProjectError> {
    current_status(deps, asset_id)
}

/// `ensure_proxy(assetId, quality?)` — devuelve el estado y, si hace falta,
/// lanza el worker de generación en background.
pub fn ensure_proxy(
    deps: &ProxyDeps<'_>,
    generator: &dyn ProxyGenerator,
    asset_id: &str,
    quality: Option<&str>,
) -> Result<ProxyStatus, ProjectError> {
    let quality = quality
        .and_then(parse_quality)
        .unwrap_or(DEFAULT_QUALITY)
        .to_owned();
    if let Some(status) = deps.runtime.status(asset_id) {
        if status.state == "queued" || status.state == "generating" {
            return Ok(status);
        }
    }
    let asset = resolve_asset(deps, asset_id)?;
    if let Some(existing) = best_existing(deps, &asset, asset_id) {
        if existing.up_to_date {
            return current_status(deps, asset_id);
        }
    }
    let (Some(ffmpeg), Some(ffprobe)) = (deps.tools.ffmpeg_path(), deps.tools.ffprobe_path())
    else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para generar un proxy",
        ));
    };
    let directory = asset.root.join(PROXY_DIR.replace('/', "\\"));
    deps.files.ensure_dir(&directory)?;
    let target = directory.join(proxy_file_name(
        asset_id,
        &quality,
        asset.mtime_ms,
        asset.bytes,
    ));
    let queued = ProxyStatus {
        asset_id: asset_id.to_owned(),
        state: "queued".to_owned(),
        quality: Some(quality.clone()),
        path: Some(normalized(
            &target.strip_prefix(&asset.root).unwrap_or(&target),
        )),
        exists: false,
        up_to_date: false,
        width: None,
        height: None,
        bytes: None,
        duration_seconds: None,
        percent: 0.0,
        phase: "queued".to_owned(),
        error: None,
        source_mtime_ms: Some(asset.mtime_ms),
        updated_at_ms: proxy::now_ms(),
    };
    let cancelled = deps.runtime.begin(asset_id, queued.clone());
    deps.events.progress(proxy::ProxyProgressEvent {
        asset_id: asset_id.to_owned(),
        quality: quality.clone(),
        state: "queued".to_owned(),
        percent: 0.0,
        phase: "queued".to_owned(),
    });
    generator.generate(crate::ports::proxies::ProxyJob {
        asset_id: asset_id.to_owned(),
        quality,
        root: asset.root,
        source: asset.source,
        target,
        ffmpeg,
        ffprobe,
        cancelled,
    });
    Ok(queued)
}

/// `cancel_proxy(assetId)` — marca el flag y reporta el estado cancelado.
pub fn cancel_proxy(deps: &ProxyDeps<'_>, asset_id: &str) -> Result<ProxyStatus, ProjectError> {
    let mut cancelled_status = None;
    if let Some(flag) = deps.runtime.flag(asset_id) {
        flag.store(true, Ordering::SeqCst);
        if let Some(mut status) = deps.runtime.status(asset_id) {
            status.state = "cancelled".to_owned();
            status.phase = "cancelled".to_owned();
            status.percent = 0.0;
            cancelled_status = Some(status);
        }
    }
    if let Some(status) = cancelled_status {
        deps.runtime.update(asset_id, status.clone());
        deps.events.progress(proxy::ProxyProgressEvent {
            asset_id: asset_id.to_owned(),
            quality: status
                .quality
                .clone()
                .unwrap_or_else(|| DEFAULT_QUALITY.to_owned()),
            state: status.state.clone(),
            percent: 0.0,
            phase: status.phase.clone(),
        });
        return Ok(status);
    }
    current_status(deps, asset_id)
}

/// `apply_proxy_to_asset(assetId)` — escribe `asset.proxy` en el proyecto
/// cuando el proxy está listo y vigente. Devuelve el asset actualizado.
pub fn apply_proxy_to_asset(
    deps: &ProxyDeps<'_>,
    asset_id: &str,
) -> Result<Option<Value>, ProjectError> {
    let status = current_status(deps, asset_id)?;
    if status.state != "ready" || !status.exists || !status.up_to_date {
        return Ok(None);
    }
    let Some(relative) = status.path.clone() else {
        return Ok(None);
    };
    let session = deps.session.require()?;
    let proxy_file = resolve_inside_root(&session.root, &relative)?;
    if !deps.files.is_file(&proxy_file) {
        return Ok(None);
    }
    let Some(ffprobe) = deps.tools.ffprobe_path() else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está configurado para validar el proxy",
        ));
    };
    let measure = probe_file(&ffprobe, &proxy_file, MediaKind::Video)?;
    let (Some(width), Some(height)) = (measure.width, measure.height) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el proxy no tiene dimensiones legibles",
        ));
    };
    let bytes = deps.files.file_len(&proxy_file).unwrap_or(0);
    let mut opened = deps.documents.open(&session.path)?;
    let index = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .position(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el medio no está en el proyecto",
            )
        })?;
    let updated = {
        let asset = &mut opened.project["assets"][index];
        asset["proxy"] = json!({
            "path": relative,
            "width": width,
            "height": height,
            "bytes": bytes,
        });
        asset.clone()
    };
    deps.documents.save(&session.path, &opened.project)?;
    Ok(Some(updated))
}

/// `cleanup_proxies(assetId?)` — borra proxies del cache; con `asset_id`
/// conserva los de ese asset.
pub fn cleanup_proxies(
    deps: &ProxyDeps<'_>,
    asset_id: Option<&str>,
) -> Result<ProxyCleanupResult, ProjectError> {
    let session = deps.session.require()?;
    Ok(deps.files.cleanup(&session.root, asset_id))
}

/// Borra los proxies cuyo asset ya no existe como video en el proyecto.
///
/// Conservador por diseño: sólo mira el id del asset en el nombre del
/// archivo. Un proxy de un asset presente se conserva aunque su huella
/// (mtime+bytes) esté vieja — ese caso lo resuelve `ensure_proxy` al
/// regenerar, y borrarlo aquí podría tirar trabajo válido si el origen está
/// temporalmente inaccesible. Devuelve el resultado para tests/informe.
pub fn cleanup_orphan_proxies(
    files: &dyn ProxyFiles,
    root: &Path,
    project: &Value,
) -> ProxyCleanupResult {
    let mut keep = HashSet::new();
    if let Some(assets) = project["assets"].as_array() {
        for asset in assets {
            if asset["kind"].as_str() != Some("video") {
                continue;
            }
            if let Some(id) = asset["id"].as_str() {
                keep.insert(id.to_owned());
            }
        }
    }
    let mut removed = 0u64;
    let mut bytes_freed = 0u64;
    for entry in files.proxy_entries(root) {
        let Some(asset_id) = proxy_asset_id(&entry.name) else {
            continue;
        };
        if keep.contains(&asset_id) {
            continue;
        }
        if files.remove_file(&entry.path) {
            removed += 1;
            bytes_freed += entry.bytes;
        }
    }
    ProxyCleanupResult {
        removed,
        bytes_freed,
    }
}

/// Limpieza best-effort de la sesión activa: borra los proxies huérfanos del
/// proyecto que está por salir (cierre o cambio de proyecto). Se llama antes
/// de adoptar/limpiar la sesión; nunca devuelve error porque el cache no
/// puede tumbar el cierre.
pub fn cleanup_session_orphans(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
    files: &dyn ProxyFiles,
) {
    let Ok(Some(info)) = session.current() else {
        return;
    };
    let Ok(opened) = documents.open(&info.path) else {
        return;
    };
    let _ = cleanup_orphan_proxies(files, &info.root, &opened.project);
}

#[cfg(test)]
mod orphan_tests {
    use super::*;
    use crate::infrastructure::proxies::LocalProxyFiles;
    use crate::media::proxy::{proxy_asset_id, proxy_file_name, PROXY_DIR};

    #[test]
    fn el_asset_id_se_lee_del_nombre_aun_con_guiones() {
        let uuid = "11111111-2222-4333-8444-555555555555";
        let name = proxy_file_name(uuid, "720p", 100, 200);
        assert_eq!(proxy_asset_id(&name).as_deref(), Some(uuid));
        assert_eq!(
            proxy_asset_id("proxy-simple-540p-1-2.mp4").as_deref(),
            Some("simple")
        );
        // Nombres ajenos o rotos no se toman como proxy.
        assert_eq!(proxy_asset_id("otro.mp4"), None);
        assert_eq!(proxy_asset_id("proxy-x-999p-1-2.mp4"), None);
        assert_eq!(proxy_asset_id("proxy--540p-1-2.mp4"), None);
        assert_eq!(proxy_asset_id("proxy-a-540p-1.mp4"), None);
    }

    fn orphan_fixture(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("olyvia-proxy-test-{}-{}", std::process::id(), tag));
        let proxies = dir.join(PROXY_DIR.replace('/', "\\"));
        std::fs::create_dir_all(&proxies).unwrap();
        dir
    }

    #[test]
    fn la_limpieza_de_huerfanos_solo_borra_assets_ausentes() {
        let root = orphan_fixture("huerfanos");
        let proxies = root.join(PROXY_DIR.replace('/', "\\"));
        let write = |name: &str, bytes: &[u8]| std::fs::write(proxies.join(name), bytes).unwrap();
        // Asset de video presente en el proyecto: se conserva.
        write(
            &proxy_file_name("asset-video", "540p", 1, 10),
            b"keep-video",
        );
        // Huérfanos: asset borrado del proyecto y asset que ya no es video.
        write(
            &proxy_file_name("asset-borrado", "540p", 1, 10),
            b"orphan-1",
        );
        write(
            &proxy_file_name("asset-borrado", "720p", 2, 20),
            b"orphan-22",
        );
        write(&proxy_file_name("asset-audio", "540p", 1, 10), b"orphan-3");
        // No son proxies: no se tocan.
        write("notas.txt", b"nada");
        write("proxy-raro-540p.mp4", b"raro");

        let project = serde_json::json!({
            "assets": [
                { "id": "asset-video", "kind": "video" },
                { "id": "asset-audio", "kind": "audio" }
            ]
        });
        let result = cleanup_orphan_proxies(&LocalProxyFiles, &root, &project);
        assert_eq!(result.removed, 3);
        assert_eq!(result.bytes_freed, 8 + 9 + 8);
        assert!(proxies
            .join(proxy_file_name("asset-video", "540p", 1, 10))
            .is_file());
        assert!(!proxies
            .join(proxy_file_name("asset-borrado", "540p", 1, 10))
            .exists());
        assert!(!proxies
            .join(proxy_file_name("asset-borrado", "720p", 2, 20))
            .exists());
        assert!(!proxies
            .join(proxy_file_name("asset-audio", "540p", 1, 10))
            .exists());
        assert!(proxies.join("notas.txt").is_file());
        assert!(proxies.join("proxy-raro-540p.mp4").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn la_limpieza_sin_carpeta_o_sin_assets_no_toca_nada() {
        let root = orphan_fixture("vacio");
        // Sin media/proxies.
        let missing = root.join("no-existe");
        let result = cleanup_orphan_proxies(
            &LocalProxyFiles,
            &missing,
            &serde_json::json!({ "assets": [] }),
        );
        assert_eq!(result.removed, 0);
        // Proyecto sin assets: todo proxy es huérfano.
        let proxies = root.join(PROXY_DIR.replace('/', "\\"));
        std::fs::create_dir_all(&proxies).unwrap();
        std::fs::write(proxies.join(proxy_file_name("a", "540p", 1, 2)), b"xx").unwrap();
        let result = cleanup_orphan_proxies(&LocalProxyFiles, &root, &serde_json::json!({}));
        assert_eq!(result.removed, 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
