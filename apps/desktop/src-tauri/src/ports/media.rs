//! Puertos del dominio Media.
//!
//! Por ahora sólo los DTOs que los casos de uso de `application::media`
//! devuelven a la capa IPC. Las herramientas (ffmpeg/ffprobe) se resuelven
//! en el adaptador de comandos vía `system::resolve_tools` hasta que el
//! dominio Media tenga su propio port de herramientas.

use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use serde::Serialize;

use crate::projects::service::ProjectError;

/// Deadline para sondas ffprobe/ffmpeg de inspección (metadatos, verificación
/// de exports, códecs): leen cabeceras y terminan en segundos; 2 min cubre
/// archivos grandes en discos lentos sin esperas eternas ante un cuelgue.
pub const MEDIA_PROBE_TIMEOUT: Duration = Duration::from_secs(120);

/// Deadline para chequeos triviales de la herramienta (`-filters`, `-version`):
/// no procesan media; si tardan más de medio minuto algo está roto.
pub const MEDIA_TOOL_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Deadline para pasadas de análisis que decodifican el medio completo sin
/// escribir (scene detect, vidstabdetect, VMAF, silencedetect/ebur128): ~5×
/// realtime con piso de 2 min y techo de 3 h. Sin duración conocida se usa el
/// techo: un asset sin metadata puede ser tan largo como el disco lo permita,
/// pero nunca una espera eterna. El techo es menor que el de los renders
/// (`proportional_media_timeout`, 24 h) porque un análisis colgado no debe
/// retener el comando IPC durante horas.
pub fn proportional_analysis_timeout(total_seconds: f64) -> Duration {
    const FACTOR: f64 = 5.0;
    const FLOOR_SECS: f64 = 120.0;
    const CEILING_SECS: f64 = 3.0 * 60.0 * 60.0;
    if !total_seconds.is_finite() || total_seconds <= 0.0 {
        return Duration::from_secs_f64(CEILING_SECS);
    }
    Duration::from_secs_f64((total_seconds * FACTOR).clamp(FLOOR_SECS, CEILING_SECS))
}

/// Estado en disco de un asset del proyecto (para `check_asset_files`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFileInfo {
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
}

/// Un corte de escena detectado: frame y timestamp en segundos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCut {
    pub frame: u64,
    pub seconds: f64,
}

/// Resultado de `detect_scenes`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneDetection {
    pub cuts: Vec<SceneCut>,
    pub duration_frames: u64,
    pub fps_num: u32,
    pub fps_den: u32,
    pub threshold: f64,
}

/// Resultado de `analyze_stabilization`: transform `.trf` escrito en disco.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StabilizationAnalysis {
    pub path: String,
    pub smoothing: u32,
    pub in_frame: u64,
    pub out_frame: u64,
    /// MP4 horneado con `vidstabtransform` para la preview en vivo. `None`
    /// cuando el bake falla: el análisis y el export no se ven afectados.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_proxy: Option<String>,
}

/// Inspección de un archivo arbitrario vía ffprobe (`probe_any_file`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: Option<f64>,
    pub format_name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    /// Timecode de inicio SMPTE (NDF) del stream de video o del contenedor,
    /// tal como lo reporta ffprobe. `None` si la fuente no lo trae.
    pub timecode: Option<String>,
}

impl MediaProbe {
    pub fn from_value(path: &Path, value: &serde_json::Value) -> Self {
        let bytes = value["format"]["size"]
            .as_str()
            .and_then(|text| text.parse::<u64>().ok())
            .unwrap_or_else(|| std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0));
        let duration_seconds = value["format"]["duration"]
            .as_str()
            .and_then(|text| text.parse::<f64>().ok());
        let streams = value["streams"].as_array();
        let video =
            streams.and_then(|items| items.iter().find(|item| item["codec_type"] == "video"));
        let audio =
            streams.and_then(|items| items.iter().find(|item| item["codec_type"] == "audio"));
        Self {
            path: path.to_string_lossy().into_owned(),
            bytes,
            duration_seconds,
            format_name: value["format"]["format_name"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            width: video
                .and_then(|item| item["width"].as_u64())
                .map(|v| v as u32),
            height: video
                .and_then(|item| item["height"].as_u64())
                .map(|v| v as u32),
            video_codec: video
                .and_then(|item| item["codec_name"].as_str())
                .map(str::to_owned),
            audio_codec: audio
                .and_then(|item| item["codec_name"].as_str())
                .map(str::to_owned),
            // El timecode vive en los tags del stream de video (MXF/ProRes) o
            // del contenedor (MOV/MP4). Preferimos el del stream.
            timecode: video
                .and_then(|item| item["tags"]["timecode"].as_str())
                .or_else(|| value["format"]["tags"]["timecode"].as_str())
                .map(str::to_owned),
        }
    }
}

/// Resultado de `import_timeline`: assets nuevos, tracks y clips listos
/// para montar, con warnings de lo que el formato no pudo representar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineImportResult {
    pub format: String,
    pub path: String,
    pub assets: Vec<serde_json::Value>,
    pub tracks: Vec<serde_json::Value>,
    pub clips: Vec<serde_json::Value>,
    pub warnings: Vec<String>,
    pub imported_clips: usize,
    pub new_assets: usize,
    pub reused_assets: usize,
}

/// Herramientas externas del usuario: rutas de ffmpeg/ffprobe configuradas.
pub trait MediaTools {
    /// `None` cuando las herramientas no están disponibles.
    fn ffmpeg_path(&self) -> Option<PathBuf>;
    /// `None` cuando ffprobe no está disponible.
    fn ffprobe_path(&self) -> Option<PathBuf>;
}

/// Ejecuta pasadas de FFmpeg/FFprobe y resuelve las rutas de salida que
/// escriben. La implementación real está en `infrastructure::media`.
pub trait MediaRunner {
    /// Ejecuta `ffmpeg <args>` con stdout y stderr capturados; `cwd` opcional.
    fn run_ffmpeg(
        &self,
        ffmpeg: &Path,
        args: &[String],
        cwd: Option<&Path>,
    ) -> Result<Output, ProjectError>;
    /// Ejecuta `ffprobe <args>` con stdout y stderr capturados.
    fn run_ffprobe(&self, ffprobe: &Path, args: &[String]) -> Result<Output, ProjectError>;
    /// Igual que `run_ffmpeg`, pero con deadline: la implementación debe
    /// matar al proceso si no termina dentro de `timeout` y devolver un error
    /// informativo en vez de quedar bloqueada para siempre. La variante sin
    /// deadline queda para operaciones largas legítimas (exports, transcodes).
    fn run_ffmpeg_with_timeout(
        &self,
        ffmpeg: &Path,
        args: &[String],
        cwd: Option<&Path>,
        timeout: Duration,
    ) -> Result<Output, ProjectError>;
    /// Igual que `run_ffprobe`, con deadline.
    fn run_ffprobe_with_timeout(
        &self,
        ffprobe: &Path,
        args: &[String],
        timeout: Duration,
    ) -> Result<Output, ProjectError>;
    /// Crea un directorio de salida si no existe.
    fn ensure_dir(&self, path: &Path) -> Result<(), ProjectError>;
    /// La ruta existe como archivo.
    fn file_exists(&self, path: &Path) -> bool;
    /// Borra un archivo de salida fallido (mejor esfuerzo).
    fn remove_file(&self, path: &Path);
}

/// Resultado de publicar un archivo de intercambio en disco.
#[derive(Debug, Clone)]
pub struct TimelineExportOutcome {
    pub path: String,
    pub bytes: u64,
    /// Clips/eventos exportados (significado según el formato).
    pub items: usize,
    /// Pistas exportadas (OTIO); 0 en los formatos que no la informan.
    pub tracks: usize,
    pub warnings: Vec<String>,
}

/// Publica el texto de un export de timeline con nombre único y escritura
/// atómica (temporal + rename). La implementación real está en
/// `infrastructure::media::LocalTimelineExportFiles`.
pub trait TimelineExportFiles {
    /// La ruta existe y es un directorio escribible.
    fn is_dir(&self, path: &Path) -> bool;
    /// Escribe `text` como `<dir>/<stem>.<extension>` sin pisar archivos
    /// existentes (`<stem>-2`, `<stem>-3`, ...). `label` es el nombre del
    /// formato para los mensajes de error ("el EDL", "FCPXML").
    fn publish(
        &self,
        dir: &Path,
        stem: &str,
        extension: &str,
        label: &str,
        text: &str,
    ) -> Result<(PathBuf, u64), ProjectError>;
}

/// Metadatos del archivo de subtítulos elegido por el usuario.
#[derive(Debug, Clone, Copy)]
pub struct SubtitleFileMeta {
    pub is_file: bool,
    pub len: u64,
}

/// Lee del disco el archivo de subtítulos que el diálogo nativo devolvió.
/// La validación de contenido vive en `media::subtitle_file`.
pub trait SubtitleFiles {
    /// `None` si la ruta ya no existe.
    fn metadata(&self, path: &Path) -> Option<SubtitleFileMeta>;
    /// Contenido completo del archivo (la talla ya fue validada).
    fn read(&self, path: &Path) -> Result<Vec<u8>, ProjectError>;
}

/// Publica un subtítulo localizado con nombre único y escritura atómica
/// (temporal oculto + rename). Las reglas de nombre/contenido viven en
/// `media::localized_subtitle`.
pub trait LocalizedSubtitleFiles {
    /// La carpeta de destino existe y es directorio.
    fn output_dir_exists(&self, dir: &Path) -> bool;
    /// Ya existe un archivo en esa ruta (para el bucle de nombre único).
    fn candidate_exists(&self, path: &Path) -> bool;
    /// Escribe el contenido en un temporal oculto `.localized-{uuid}.{ext}`
    /// dentro de `dir` y devuelve `(temp_path, bytes_escritos)`.
    fn write_temp(
        &self,
        dir: &Path,
        extension: &str,
        content: &str,
    ) -> Result<(PathBuf, u64), ProjectError>;
    /// Tamaño actual de un archivo publicado (`None` si no se pudo leer).
    fn file_len(&self, path: &Path) -> Option<u64>;
    /// Rename atómico temporal → destino; borra el temporal si falla.
    fn publish(&self, temp: &Path, final_path: &Path) -> Result<(), ProjectError>;
}
