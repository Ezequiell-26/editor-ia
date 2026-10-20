//! Validación y persistión del documento de proyecto.
//!
//! Los tipos de este módulo son el contrato con la interfaz: un error siempre
//! lleva un código estable y una lista de incidencias con la ruta punteada que
//! falló, nunca el valor recibido. Las rutas absolutas del usuario no se
//! reproducen en los mensajes.
//!
//! Qué espeja este archivo de `docs/architecture/PROJECT-FORMAT.md`: la sección
//! 2 (credenciales en cualquier nivel, namespace `x-` en la raíz, ids uuid v4,
//! unicidad dentro de cada colección), la sección 4 (rutas), la 6 (las once
//! reglas de integridad referencial) y la identidad de timing de la sección 3.
//! La forma fina de cada entidad la sigue validando el paquete de esquema en
//! TypeScript, que es la autoridad del contrato; acá se corta lo que un
//! validador de esquema no puede expresar.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::storage;

pub const PROJECT_SCHEMA_VERSION: u64 = 1;

const KNOWN_ROOT_KEYS: [&str; 19] = [
    "id",
    "name",
    "schemaVersion",
    "createdAt",
    "updatedAt",
    "revision",
    "language",
    "video",
    "look",
    "assets",
    "timeline",
    "captions",
    "scenes",
    "motion",
    "audio",
    "renderProfiles",
    "exportVariants",
    "provenance",
    "migrationHistory",
];

/// Mismo conjunto que rechaza el validador de TypeScript, con las variantes de
/// separador que admite su expresión regular.
const CREDENTIAL_KEYS: [&str; 23] = [
    "api_key",
    "api-key",
    "apikey",
    "access_token",
    "access-token",
    "accesstoken",
    "refresh_token",
    "refresh-token",
    "refreshtoken",
    "secret",
    "password",
    "passwd",
    "authorization",
    "auth_token",
    "auth-token",
    "authtoken",
    "bearer_token",
    "bearer-token",
    "bearertoken",
    "cookie",
    "private_key",
    "private-key",
    "privatekey",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectErrorCode {
    UnsupportedSchemaVersion,
    InvalidJson,
    InvalidProject,
    PathEscapesRoot,
    FileTooLarge,
    AlreadyExists,
    NotFound,
    Io,
    ProviderUnavailable,
    ProviderRejected,
    InvalidProviderResponse,
    CostNotApproved,
    KeyringUnavailable,
    RenderFailed,
    RenderCancelled,
    RenderBusy,
    EmptyTimeline,
    AssetNotReady,
    UnsupportedSpeed,
    SessionMismatch,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectIssue {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ProjectError {
    pub code: ProjectErrorCode,
    pub message: String,
    pub issues: Vec<ProjectIssue>,
}

impl ProjectErrorCode {
    pub fn name(self) -> &'static str {
        match self {
            ProjectErrorCode::UnsupportedSchemaVersion => "UNSUPPORTED_SCHEMA_VERSION",
            ProjectErrorCode::InvalidJson => "INVALID_JSON",
            ProjectErrorCode::InvalidProject => "INVALID_PROJECT",
            ProjectErrorCode::PathEscapesRoot => "PATH_ESCAPES_ROOT",
            ProjectErrorCode::FileTooLarge => "FILE_TOO_LARGE",
            ProjectErrorCode::AlreadyExists => "ALREADY_EXISTS",
            ProjectErrorCode::NotFound => "NOT_FOUND",
            ProjectErrorCode::Io => "IO",
            ProjectErrorCode::ProviderUnavailable => "PROVIDER_UNAVAILABLE",
            ProjectErrorCode::ProviderRejected => "PROVIDER_REJECTED",
            ProjectErrorCode::InvalidProviderResponse => "INVALID_PROVIDER_RESPONSE",
            ProjectErrorCode::CostNotApproved => "COST_NOT_APPROVED",
            ProjectErrorCode::KeyringUnavailable => "KEYRING_UNAVAILABLE",
            ProjectErrorCode::RenderFailed => "RENDER_FAILED",
            ProjectErrorCode::RenderCancelled => "RENDER_CANCELLED",
            ProjectErrorCode::RenderBusy => "RENDER_BUSY",
            ProjectErrorCode::EmptyTimeline => "EMPTY_TIMELINE",
            ProjectErrorCode::AssetNotReady => "ASSET_NOT_READY",
            ProjectErrorCode::UnsupportedSpeed => "UNSUPPORTED_SPEED",
            ProjectErrorCode::SessionMismatch => "SESSION_MISMATCH",
        }
    }
}

/// The UI receives a stable code, a safe sentence and the punctual issues; the
/// received document values and absolute paths never cross this boundary.
impl serde::Serialize for ProjectError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ProjectError", 3)?;
        state.serialize_field("code", self.code.name())?;
        state.serialize_field("message", &self.message)?;
        state.serialize_field("issues", &self.issues)?;
        state.end()
    }
}

impl ProjectError {
    pub fn message(code: ProjectErrorCode, message: &str) -> Self {
        Self {
            code,
            message: message.to_owned(),
            issues: Vec::new(),
        }
    }

    fn single(code: ProjectErrorCode, message: &str, path: &str, detail: &str) -> Self {
        Self {
            code,
            message: message.to_owned(),
            issues: vec![ProjectIssue {
                path: path.to_owned(),
                message: detail.to_owned(),
            }],
        }
    }

    fn accumulated(message: &str, issues: Vec<ProjectIssue>) -> Self {
        Self {
            code: ProjectErrorCode::InvalidProject,
            message: message.to_owned(),
            issues,
        }
    }
}

#[derive(Debug, Clone)]
pub struct OpenedProject {
    pub project: Value,
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct SaveProjectResult {
    pub path: String,
    pub revision: u64,
    pub bytes: u64,
}

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key)
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    field(value, key).and_then(Value::as_str)
}

fn number(value: &Value, key: &str) -> Option<u64> {
    field(value, key).and_then(Value::as_u64)
}

fn items<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    field(value, key)
        .and_then(Value::as_array)
        .map(|array| array.iter().collect())
        .unwrap_or_default()
}

fn nested<'a>(value: &'a Value, outer: &str, key: &str) -> Vec<&'a Value> {
    items(field(value, outer).unwrap_or(&Value::Null), key)
}

fn id_set(values: &[&Value]) -> HashSet<String> {
    values
        .iter()
        .filter_map(|item| text(item, "id"))
        .map(str::to_owned)
        .collect()
}

fn is_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for index in [8usize, 13, 18, 23] {
        if bytes[index] != b'-' {
            return false;
        }
    }
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 8 | 13 | 18 | 23) {
            continue;
        }
        if !byte.is_ascii_hexdigit() {
            return false;
        }
    }
    bytes[14].to_ascii_lowercase() == b'4' && matches!(bytes[19].to_ascii_lowercase(), b'8'..=b'b')
}

static UUID_SEED: AtomicU64 = AtomicU64::new(0);

fn mix(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    value
}

/// Identificador de documento, no material criptografico: se arma con reloj,
/// proceso y contador, y alcanza para ids que nunca se escriben a mano.
fn new_uuid_v4() -> String {
    let clock = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos() as u64)
        .unwrap_or(0);
    let seed = mix(clock
        ^ (std::process::id() as u64).wrapping_mul(0xD6E8_FEB8_6659_FD93)
        ^ UUID_SEED.fetch_add(1, Ordering::SeqCst));
    let tail = mix(seed ^ 0xA076_1D64_78BD_642F);
    let variant = ((tail >> 48) as u16 & 0x0FFF) | 0x8000;
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (seed >> 32) as u32,
        (seed >> 16) as u16,
        (seed & 0x0FFF) as u16,
        variant,
        tail & 0x0000_FFFF_FFFF_FFFF,
    )
}

/// Convierte dias desde el epoch a fecha civil (algoritmo de Hinnant).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_probe = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_probe + 2) / 5 + 1) as u32;
    let month = if month_probe < 10 {
        month_probe + 3
    } else {
        month_probe - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

pub(crate) fn now_rfc3339() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    let rest = seconds % 86_400;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year,
        month,
        day,
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

fn is_credential_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    let stripped = normalized.strip_prefix("x-").unwrap_or(&normalized);
    CREDENTIAL_KEYS.contains(&stripped)
}

fn collect_credential_paths(value: &Value, prefix: String, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };
                if is_credential_key(key) {
                    out.push(path.clone());
                }
                collect_credential_paths(child, path, out);
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                collect_credential_paths(child, format!("{}[{}]", prefix, index), out);
            }
        }
        _ => {}
    }
}

fn path_problem(value: &str) -> Option<&'static str> {
    if value.is_empty() {
        return Some("la ruta esta vacia");
    }
    if value.chars().count() > 512 {
        return Some("la ruta excede los 512 caracteres");
    }
    if value.starts_with('/') {
        return Some("la ruta es absoluta");
    }
    if value.starts_with('~') {
        return Some("la ruta apunta al home del usuario");
    }
    let bytes = value.as_bytes();
    if bytes.len() > 1 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some("la ruta trae letra de unidad");
    }
    if value.contains('\\') {
        return Some("la ruta usa barra invertida");
    }
    if value.chars().any(|character| (character as u32) < 0x20) {
        return Some("la ruta trae caracteres de control");
    }
    if value.contains(['<', '>', ':', '"', '|', '?', '*']) {
        return Some("la ruta usa caracteres reservados");
    }
    if value.ends_with('/') {
        return Some("la ruta termina en separador");
    }
    for segment in value.split('/') {
        if segment.is_empty() || segment == ".." || segment == "." {
            return Some("la ruta tiene un segmento vacio, . o ..");
        }
    }
    None
}

fn envelope_issues(document: &Value, issues: &mut Vec<ProjectIssue>) {
    let mut check = |path: &str, present: bool, message: &str| {
        if !present {
            issues.push(ProjectIssue {
                path: path.to_owned(),
                message: message.to_owned(),
            });
        }
    };

    check(
        "id",
        text(document, "id").is_some_and(is_uuid_v4),
        "el id del proyecto debe ser un uuid v4 generado por la aplicacion",
    );
    check(
        "name",
        text(document, "name").is_some_and(|name| {
            !name.is_empty() && name == name.trim() && name.chars().count() <= 120
        }),
        "el nombre necesita entre 1 y 120 caracteres sin espacios sobrantes",
    );
    check(
        "schemaVersion",
        number(document, "schemaVersion").is_some(),
        "falta la version de esquema",
    );
    check(
        "createdAt",
        text(document, "createdAt").is_some(),
        "falta la fecha de creacion",
    );
    check(
        "updatedAt",
        text(document, "updatedAt").is_some(),
        "falta la fecha de actualizacion",
    );
    check(
        "revision",
        number(document, "revision").is_some(),
        "la revision debe ser un entero",
    );
    check(
        "language",
        text(document, "language").is_some(),
        "falta el idioma del proyecto",
    );

    let video = field(document, "video");
    check(
        "video",
        video.is_some_and(|video| {
            video.get("width").and_then(Value::as_u64).unwrap_or(0) > 0
                && video.get("width").and_then(Value::as_u64).unwrap_or(0) <= 16_384
                && video.get("height").and_then(Value::as_u64).unwrap_or(0) > 0
                && video.get("height").and_then(Value::as_u64).unwrap_or(0) <= 16_384
                && video
                    .get("frameRate")
                    .map(|rate| {
                        rate.get("num").and_then(Value::as_u64).unwrap_or(0) > 0
                            && rate.get("den").and_then(Value::as_u64).unwrap_or(0) > 0
                    })
                    .unwrap_or(false)
        }),
        "las dimensiones y la tasa de cuadros deben ser enteros positivos acotados",
    );
}

fn collection_issues(document: &Value, issues: &mut Vec<ProjectIssue>) {
    let collections: [(&str, Vec<&Value>); 12] = [
        ("assets", items(document, "assets")),
        ("timeline.tracks", nested(document, "timeline", "tracks")),
        ("timeline.clips", nested(document, "timeline", "clips")),
        ("scenes", items(document, "scenes")),
        ("motion", items(document, "motion")),
        ("captions.styles", nested(document, "captions", "styles")),
        ("captions.cues", nested(document, "captions", "cues")),
        ("renderProfiles", items(document, "renderProfiles")),
        ("exportVariants", items(document, "exportVariants")),
        (
            "provenance.sources",
            nested(document, "provenance", "sources"),
        ),
        (
            "provenance.claims",
            nested(document, "provenance", "claims"),
        ),
        (
            "provenance.operations",
            nested(document, "provenance", "operations"),
        ),
    ];

    for (name, values) in collections {
        let mut seen: HashSet<String> = HashSet::new();
        for (index, item) in values.iter().enumerate() {
            let path = format!("{}[{}].id", name, index);
            match text(item, "id") {
                None => issues.push(ProjectIssue {
                    path,
                    message: "cada entrada de la coleccion necesita un id".to_owned(),
                }),
                Some(id) => {
                    if !is_uuid_v4(id) {
                        issues.push(ProjectIssue {
                            path,
                            message: "los ids deben ser uuid v4 generados por la aplicacion"
                                .to_owned(),
                        });
                    }
                    if !seen.insert(id.to_owned()) {
                        issues.push(ProjectIssue {
                            path: name.to_owned(),
                            message: "hay un id repetido dentro de la coleccion".to_owned(),
                        });
                    }
                }
            }
        }
    }
}

fn missing(issues: &mut Vec<ProjectIssue>, path: String, what: &str) {
    issues.push(ProjectIssue {
        path,
        message: format!("apunta a un {} que no esta en el archivo", what),
    });
}

fn integrity_issues(document: &Value, issues: &mut Vec<ProjectIssue>) {
    let asset_ids = id_set(&items(document, "assets"));
    let tracks = nested(document, "timeline", "tracks");
    let track_ids = id_set(&tracks);
    let clips = nested(document, "timeline", "clips");
    let clip_ids = id_set(&clips);
    let motion_ids = id_set(&items(document, "motion"));
    let scene_ids = id_set(&items(document, "scenes"));
    let style_ids = id_set(&nested(document, "captions", "styles"));
    let profile_ids = id_set(&items(document, "renderProfiles"));
    let sources = field(document, "provenance").map(|value| items(value, "sources"));
    let source_ids = id_set(&sources.unwrap_or_default());

    // Reglas 1 y 2, mas la identidad de timing de la seccion 3.
    for (index, clip) in clips.iter().enumerate() {
        let Some(source) = field(clip, "source") else {
            issues.push(ProjectIssue {
                path: format!("timeline.clips[{}].source", index),
                message: "todo clip necesita una fuente".to_owned(),
            });
            continue;
        };
        match text(source, "type") {
            Some("asset") => {
                let path = format!("timeline.clips[{}].source.assetId", index);
                match text(source, "assetId") {
                    None => missing(issues, path, "asset"),
                    Some(asset_id) => {
                        if !asset_ids.contains(asset_id) {
                            missing(issues, path, "asset");
                        }
                    }
                }
                let duration = number(clip, "durationFrames");
                let window = match (
                    number(source, "outFrame"),
                    number(source, "inFrame"),
                    duration,
                ) {
                    (Some(out), Some(in_frame), Some(duration)) => {
                        out.checked_sub(in_frame).map(|window| (window, duration))
                    }
                    _ => None,
                };
                if let Some((window, duration)) = window {
                    let speed = field(clip, "speed");
                    let num = speed.and_then(|value| number(value, "num")).unwrap_or(1);
                    let den = speed.and_then(|value| number(value, "den")).unwrap_or(1);
                    if duration != 0 && den != 0 && duration * num != window * den {
                        issues.push(ProjectIssue {
                            path: format!("timeline.clips[{}].durationFrames", index),
                            message: format!(
                                "la identidad de timing no cierra: {} x {} != {} x {}",
                                duration, num, window, den
                            ),
                        });
                    }
                }
            }
            Some("graphic") => {
                let path = format!("timeline.clips[{}].source.motionId", index);
                match text(source, "motionId") {
                    None => missing(issues, path, "motion"),
                    Some(motion_id) => {
                        if !motion_ids.contains(motion_id) {
                            missing(issues, path, "motion");
                        }
                    }
                }
            }
            Some("adjustment") => {}
            Some(other) => issues.push(ProjectIssue {
                path: format!("timeline.clips[{}].source.type", index),
                message: format!("tipo de fuente desconocido: {}", other),
            }),
            None => issues.push(ProjectIssue {
                path: format!("timeline.clips[{}].source.type", index),
                message: "la fuente del clip no declara su tipo".to_owned(),
            }),
        }
    }

    // Regla 3.
    for (index, item) in items(document, "motion").iter().enumerate() {
        let path = format!("motion[{}].targetTrackId", index);
        match text(item, "targetTrackId") {
            None => missing(issues, path, "track"),
            Some(track_id) => {
                if !track_ids.contains(track_id) {
                    missing(issues, path, "track");
                }
            }
        }
    }

    // Reglas 4 y 5.
    let track_kind = |wanted: &str| -> HashSet<String> {
        tracks
            .iter()
            .filter(|track| text(track, "kind") == Some(wanted))
            .filter_map(|track| text(track, "id"))
            .map(str::to_owned)
            .collect()
    };
    let caption_tracks = track_kind("caption");
    for (index, cue) in nested(document, "captions", "cues").iter().enumerate() {
        let track_path = format!("captions.cues[{}].trackId", index);
        match text(cue, "trackId") {
            None => missing(issues, track_path, "track"),
            Some(track_id) => {
                if !track_ids.contains(track_id) {
                    missing(issues, track_path, "track");
                } else if !caption_tracks.contains(track_id) {
                    issues.push(ProjectIssue {
                        path: track_path,
                        message: "una pista de subtitulos debe apuntar a un track de tipo caption"
                            .to_owned(),
                    });
                }
            }
        }
        let style_path = format!("captions.cues[{}].styleId", index);
        match text(cue, "styleId") {
            None => missing(issues, style_path, "estilo"),
            Some(style_id) => {
                if !style_ids.contains(style_id) {
                    missing(issues, style_path, "estilo");
                }
            }
        }
    }

    // Regla 6.
    for (index, scene) in items(document, "scenes").iter().enumerate() {
        let clip_ids_here = field(scene, "clipIds").and_then(Value::as_array);
        match clip_ids_here {
            None => issues.push(ProjectIssue {
                path: format!("scenes[{}].clipIds", index),
                message: "la escena no declara sus clips".to_owned(),
            }),
            Some(values) => {
                for (position, value) in values.iter().enumerate() {
                    let path = format!("scenes[{}].clipIds[{}]", index, position);
                    match value.as_str() {
                        None => missing(issues, path, "clip"),
                        Some(clip_id) => {
                            if !clip_ids.contains(clip_id) {
                                missing(issues, path, "clip");
                            }
                        }
                    }
                }
            }
        }
    }

    // Regla 7.
    for (index, variant) in items(document, "exportVariants").iter().enumerate() {
        let path = format!("exportVariants[{}].renderProfileId", index);
        match text(variant, "renderProfileId") {
            None => missing(issues, path, "perfil de render"),
            Some(profile_id) => {
                if !profile_ids.contains(profile_id) {
                    missing(issues, path, "perfil de render");
                }
            }
        }
    }

    let audio = field(document, "audio");

    // Regla 8.
    if let Some(music) = audio.and_then(|value| field(value, "music")) {
        let path = "audio.music.assetId".to_owned();
        match text(music, "assetId") {
            None => missing(issues, path, "asset"),
            Some(asset_id) => {
                if !asset_ids.contains(asset_id) {
                    missing(issues, path, "asset");
                }
            }
        }
    }

    // Regla 9.
    if let Some(ducking) = audio.and_then(|value| field(value, "ducking")) {
        for key in ["sourceTrackIds", "targetTrackIds"] {
            if let Some(values) = field(ducking, key).and_then(Value::as_array) {
                for (position, value) in values.iter().enumerate() {
                    let path = format!("audio.ducking.{}[{}]", key, position);
                    match value.as_str() {
                        None => missing(issues, path, "track"),
                        Some(track_id) => {
                            if !track_ids.contains(track_id) {
                                missing(issues, path, "track");
                            }
                        }
                    }
                }
            }
        }
    }

    // Reglas 10 y 11.
    if let Some(claims) = field(document, "provenance").map(|value| items(value, "claims")) {
        for (index, claim) in claims.iter().enumerate() {
            if let Some(values) = field(claim, "sourceIds").and_then(Value::as_array) {
                for (position, value) in values.iter().enumerate() {
                    let path = format!("provenance.claims[{}].sourceIds[{}]", index, position);
                    match value.as_str() {
                        None => missing(issues, path, "fuente"),
                        Some(source_id) => {
                            if !source_ids.contains(source_id) {
                                missing(issues, path, "fuente");
                            }
                        }
                    }
                }
            }
            let scene_path = format!("provenance.claims[{}].sceneId", index);
            match text(claim, "sceneId") {
                None => missing(issues, scene_path, "escena"),
                Some(scene_id) => {
                    if !scene_ids.contains(scene_id) {
                        missing(issues, scene_path, "escena");
                    }
                }
            }
        }
    }
}

fn validate_document(document: &Value) -> Result<(), ProjectError> {
    let Some(object) = document.as_object() else {
        return Err(ProjectError::single(
            ProjectErrorCode::InvalidProject,
            "el proyecto debe ser un objeto JSON",
            "",
            "la raiz del documento no es un objeto",
        ));
    };

    if let Some(version) = field(document, "schemaVersion") {
        if version.as_u64() != Some(PROJECT_SCHEMA_VERSION) {
            let shown = version
                .as_u64()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "un valor que no es numero".to_owned());
            return Err(ProjectError::single(
                ProjectErrorCode::UnsupportedSchemaVersion,
                &format!(
                    "el archivo declara la version {}; Editor IA abre solo la version {}",
                    shown, PROJECT_SCHEMA_VERSION
                ),
                "schemaVersion",
                "version de esquema no soportada",
            ));
        }
    }

    let mut credentials: Vec<String> = Vec::new();
    collect_credential_paths(document, String::new(), &mut credentials);
    if !credentials.is_empty() {
        return Err(ProjectError::accumulated(
            "el documento tiene claves con forma de credencial",
            credentials
                .into_iter()
                .map(|path| ProjectIssue {
                    path,
                    message: "las credenciales viven en el almacen del sistema, no en el proyecto"
                        .to_owned(),
                })
                .collect(),
        ));
    }

    let mut issues: Vec<ProjectIssue> = Vec::new();
    for key in object.keys() {
        if !KNOWN_ROOT_KEYS.contains(&key.as_str()) && !key.starts_with("x-") {
            issues.push(ProjectIssue {
                path: key.clone(),
                message: "clave raiz desconocida; solo se admite el prefijo x-".to_owned(),
            });
        }
    }

    envelope_issues(document, &mut issues);
    collection_issues(document, &mut issues);

    let mut escaping: Vec<ProjectIssue> = Vec::new();
    for (index, asset) in items(document, "assets").iter().enumerate() {
        if let Some(path) = asset.get("source").and_then(|source| source.get("path")) {
            if let Some(value) = path.as_str() {
                if let Some(problem) = path_problem(value) {
                    escaping.push(ProjectIssue {
                        path: format!("assets[{}].source.path", index),
                        message: problem.to_owned(),
                    });
                }
            }
        }
    }
    if !escaping.is_empty() {
        return Err(ProjectError {
            code: ProjectErrorCode::PathEscapesRoot,
            message: "una ruta de material escapa la raiz del proyecto".to_owned(),
            issues: escaping,
        });
    }

    integrity_issues(document, &mut issues);

    if issues.is_empty() {
        return Ok(());
    }

    Err(ProjectError::accumulated(
        "el documento no cumple el formato de proyecto v1",
        issues,
    ))
}

fn render(document: &Value) -> Result<String, ProjectError> {
    serde_json::to_string_pretty(document).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("el documento no se pudo serializar: {}", error),
        )
    })
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    a = a.max(1);
    b = b.max(1);
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a.max(1)
}

fn aspect_ratio(width: u64, height: u64) -> String {
    let divisor = gcd_u64(width, height);
    format!("{}:{}", width / divisor, height / divisor)
}

fn profile(name: &str, width: u64, height: u64, frame_rate: &Value, min_bytes: u64) -> Value {
    json!({
        "id": new_uuid_v4(),
        "name": name,
        "container": "mp4",
        "videoCodec": "h264",
        "audioCodec": "aac",
        "resolution": { "width": width, "height": height },
        "frameRate": frame_rate.clone(),
        "bitrate": { "mode": "crf", "crf": 22 },
        "videoPreset": "veryfast",
        "fit": "contain",
        "pixelFormat": "yuv420p",
        "audioSampleRate": 48_000,
        "audioChannels": 2,
        "audioBitsPerSecond": 128_000,
        "aspectRatio": aspect_ratio(width, height),
        "qualityGate": {
            "minOutputBytes": min_bytes,
            "durationToleranceFrames": 10,
            "requireAllAssetsReady": true
        }
    })
}

fn default_delivery(frame_rate: &Value, width: u64, height: u64) -> (Vec<Value>, Vec<Value>) {
    let mut profiles = Vec::new();
    let standard = [(1920u64, 1080u64), (1080, 1920), (1080, 1080)];
    if !standard.contains(&(width, height)) {
        profiles.push(profile(
            &format!("Formato del proyecto {width}×{height}"),
            width,
            height,
            frame_rate,
            50_000,
        ));
    }
    let youtube = profile("YouTube 1080p", 1920, 1080, frame_rate, 500_000);
    let shorts = profile("Shorts 1080x1920", 1080, 1920, frame_rate, 300_000);
    let feed = profile("Feed 1080x1080", 1080, 1080, frame_rate, 250_000);
    let youtube_id = youtube["id"].as_str().unwrap_or_default().to_owned();
    let shorts_id = shorts["id"].as_str().unwrap_or_default().to_owned();
    let feed_id = feed["id"].as_str().unwrap_or_default().to_owned();
    profiles.push(youtube);
    profiles.push(shorts);
    profiles.push(feed);
    let variants = vec![
        json!({
            "id": new_uuid_v4(),
            "name": "YouTube",
            "renderProfileId": youtube_id,
            "platform": "youtube"
        }),
        json!({
            "id": new_uuid_v4(),
            "name": "Shorts",
            "renderProfileId": shorts_id,
            "platform": "shorts"
        }),
        json!({
            "id": new_uuid_v4(),
            "name": "Feed",
            "renderProfileId": feed_id,
            "platform": "other"
        }),
    ];
    (profiles, variants)
}

/// Crea un documento v1 nuevo con entrega 16:9 y 9:16 declaradas, y lo escribe
/// sin pisar nada existente.
pub fn create_project(path: &Path, name: &str) -> Result<OpenedProject, ProjectError> {
    create_project_with_video(path, name, None)
}

/// Igual que `create_project` pero permite fijar la resolución y tasa del
/// proyecto al momento de crearlo.
pub fn create_project_with_video(
    path: &Path,
    name: &str,
    video: Option<Value>,
) -> Result<OpenedProject, ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::single(
            ProjectErrorCode::InvalidProject,
            "el proyecto necesita un nombre",
            "name",
            "el nombre no puede quedar vacio",
        ));
    }
    if storage::exists(path) {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            &format!(
                "ya existe un archivo de proyecto con ese nombre: {}",
                storage::display_name(path)
            ),
        ));
    }

    let stamp = now_rfc3339();
    let video = video.unwrap_or_else(
        || json!({ "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } }),
    );
    let frame_rate = video
        .get("frameRate")
        .cloned()
        .unwrap_or_else(|| json!({ "num": 30, "den": 1 }));
    let width = video
        .get("width")
        .and_then(Value::as_u64)
        .unwrap_or(1920)
        .clamp(16, 16_384);
    let height = video
        .get("height")
        .and_then(Value::as_u64)
        .unwrap_or(1080)
        .clamp(16, 16_384);
    let (profiles, variants) = default_delivery(&frame_rate, width, height);

    let document = json!({
        "id": new_uuid_v4(),
        "name": trimmed,
        "schemaVersion": PROJECT_SCHEMA_VERSION,
        "createdAt": stamp,
        "updatedAt": stamp,
        "revision": 0,
        "language": "es",
        "video": video,
        "assets": [],
        "timeline": { "tracks": [], "clips": [] },
        "captions": { "styles": [], "cues": [] },
        "scenes": [],
        "motion": [],
        "audio": {},
        "renderProfiles": profiles,
        "exportVariants": variants,
        "provenance": { "sources": [], "claims": [], "operations": [] },
        "migrationHistory": []
    });

    validate_document(&document)?;
    storage::write_project_file(path, &render(&document)?)?;
    Ok(OpenedProject {
        project: document,
        path: path_text(path),
    })
}

/// Lee, valida y abre. Un documento malformado se rechaza con la ruta que
/// falló; nunca se abre a medias.
pub fn open_project(path: &Path) -> Result<OpenedProject, ProjectError> {
    let contents = storage::read_project_file(path)?;
    let document: Value = serde_json::from_str(&contents).map_err(|error| {
        ProjectError::single(
            ProjectErrorCode::InvalidJson,
            &format!(
                "el archivo no se pudo leer como JSON: {}",
                storage::display_name(path)
            ),
            "",
            &error.to_string(),
        )
    })?;
    validate_document(&document)?;
    Ok(OpenedProject {
        project: document,
        path: path_text(path),
    })
}

/// Valida antes de tocar el disco y escribe por temporal + `rename`.
pub fn save_project(path: &Path, project: &Value) -> Result<SaveProjectResult, ProjectError> {
    validate_document(project)?;
    let bytes = storage::write_project_file(path, &render(project)?)?;
    Ok(SaveProjectResult {
        path: path_text(path),
        revision: number(project, "revision").unwrap_or(0),
        bytes,
    })
}
