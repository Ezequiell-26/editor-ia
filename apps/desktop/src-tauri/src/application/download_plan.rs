//! Normalización y validación del `DownloadRequest` — la fase pura de
//! `download_blocking` (kind, compresión, codecs, HDR, proxy, rate limit,
//! subtítulos, SponsorBlock, recorte, delogo, upscale, enrutado automático,
//! voz, look cinematográfico). Los chequeos que dependen del runtime
//! (FFmpeg/Piper presentes, archivo de audio en disco) quedan en commands.

use std::path::PathBuf;

use crate::media::download_filters::{cinematic_focus, delogo_corner};
use super::downloads::{
    audio_language, cookies_browser, playlist_items, sponsorblock_categories,
    sponsorblock_category_list, subtitle_languages, valid_format_id, AutoRouteDecision,
    DelogoManualRect, DownloadRequest, MAX_HEIGHT,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

fn invalid_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

/// Request ya validado y normalizado: todos los valores que las fases
/// siguientes (línea de comando yt-dlp, post-proceso FFmpeg, outcome) usan.
#[derive(Debug)]
pub struct DownloadPlan {
    pub kind: String,
    pub format: String,
    pub audio_only: bool,
    pub codec: String,
    pub hdr_mode: String,
    pub quality: String,
    pub max_height: u32,
    pub proxy: Option<String>,
    pub limit_rate: Option<String>,
    pub download_subtitles: bool,
    pub subtitle_langs: String,
    pub download_thumbnail: bool,
    pub download_chapters: bool,
    pub sponsorblock: bool,
    pub sponsorblock_categories: String,
    pub sponsorblock_mark: Vec<String>,
    pub sponsorblock_mute: Vec<String>,
    pub trim_start: f64,
    pub trim_end: Option<f64>,
    pub cookies_from_browser: Option<String>,
    pub playlist: bool,
    pub playlist_items: Option<String>,
    pub audio_language: Option<String>,
    pub audio_format_id: Option<String>,
    pub filename_template: Option<String>,
    pub requested_crf: Option<u32>,
    pub target_size_mb: Option<u64>,
    pub compression_allowed: bool,
    pub should_compress: bool,
    pub crf: Option<u32>,
    pub cinematic: bool,
    pub cinematic_focus: Option<&'static str>,
    pub auto_pipeline: bool,
    pub delogo_corner: Option<&'static str>,
    pub manual_delogo: Option<DelogoManualRect>,
    pub upscale_mode: Option<String>,
    pub keep_original: bool,
    pub auto_route: bool,
    pub route_decision: Option<AutoRouteDecision>,
    pub source_title: String,
    pub source_duration: f64,
    pub long_video: bool,
    pub voice_enabled: bool,
    pub voice_script: String,
    pub replacement_audio: Option<PathBuf>,
    pub has_replacement_audio: bool,
    pub audio_speed_noise: bool,
    pub watermark_enabled: bool,
}

/// Valida y normaliza el request. Errores `InvalidProject` con el mismo
/// mensaje que antes; las dependencias de runtime se chequean afuera.
pub fn normalize_download_request(request: &DownloadRequest) -> Result<DownloadPlan, ProjectError> {
    let kind = request.kind.as_deref().unwrap_or("video");
    if !matches!(kind, "video" | "image" | "audio" | "gallery") {
        return Err(invalid_error("El tipo de descarga no es válido."));
    }
    let compression = request.compression.as_deref().unwrap_or("none");
    let requested_crf = match compression {
        "none" => None,
        "high" => Some(20),
        "balanced" => Some(24),
        "compact" => Some(27),
        _ => return Err(invalid_error("El nivel de compresión no es válido.")),
    };
    let codec = match request.codec.as_deref().unwrap_or("h265") {
        "h265" | "h264" | "av1" => request.codec.as_deref().unwrap_or("h265"),
        _ => return Err(invalid_error("El códec de compresión no es válido.")),
    };
    let hdr_mode = match request.hdr_mode.as_deref().unwrap_or("tonemap") {
        "tonemap" => "tonemap",
        "preserve" => "preserve",
        _ => return Err(invalid_error("El modo HDR no es válido.")),
    };
    let quality = match request.quality.as_deref().unwrap_or("best") {
        "best" | "worst" | "height" => request.quality.as_deref().unwrap_or("best"),
        _ => return Err(invalid_error("La preferencia de calidad no es válida.")),
    };
    let requested_format = request
        .format
        .as_deref()
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let format = match requested_format.as_str() {
        "mp4" | "mkv" | "webm" | "mp3" | "m4a" => requested_format.as_str(),
        _ => return Err(invalid_error("El formato de salida no es válido.")),
    };
    let audio_only = matches!(format, "mp3" | "m4a");
    let proxy = request
        .proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(proxy) = proxy {
        let lower = proxy.to_ascii_lowercase();
        if !(lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("socks4://")
            || lower.starts_with("socks5://"))
            || proxy.len() > 500
        {
            return Err(invalid_error(
                "El proxy debe ser http://, https://, socks4:// o socks5://.",
            ));
        }
    }
    let limit_rate = request
        .limit_rate
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(rate) = limit_rate {
        let valid = rate.len() <= 12
            && rate.chars().next().is_some_and(|ch| ch.is_ascii_digit())
            && rate
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, 'K' | 'M' | 'G' | 'k' | 'm' | 'g'));
        if !valid {
            return Err(invalid_error(
                "El límite de bajada debe ser un tamaño como 500K u 8M.",
            ));
        }
    }
    let download_subtitles = request.download_subtitles.unwrap_or(false);
    let subtitle_langs = subtitle_languages(request.subtitle_langs.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let download_thumbnail = request.download_thumbnail.unwrap_or(false);
    let download_chapters = request.download_chapters.unwrap_or(false);
    let sponsorblock = request.sponsorblock.unwrap_or(false);
    let keep_original = request.keep_original.unwrap_or(false);
    let sponsorblock_categories =
        sponsorblock_categories(request.sponsorblock_categories.as_deref())
            .map_err(|message| invalid_error(&message))?;
    let mut sponsorblock_mark = match request
        .sponsorblock_mark
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            sponsorblock_category_list(Some(value)).map_err(|message| invalid_error(&message))?
        }
        None => Vec::new(),
    };
    sponsorblock_mark.retain(|category| {
        !sponsorblock_categories
            .split(',')
            .any(|item| item == category.as_str())
    });
    let sponsorblock_mute = match request
        .sponsorblock_mute
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            sponsorblock_category_list(Some(value)).map_err(|message| invalid_error(&message))?
        }
        None => Vec::new(),
    };
    let cookies_from_browser = cookies_browser(request.cookies_from_browser.as_deref())?;
    let trim_start = request.trim_start.unwrap_or(0.0).max(0.0);
    let trim_end = request
        .trim_end
        .filter(|end| end.is_finite() && *end > trim_start);
    if request.trim_end.is_some() && trim_end.is_none() {
        return Err(invalid_error(
            "El recorte previo necesita un final mayor que el inicio.",
        ));
    }
    if trim_end.is_some() && matches!(kind, "image" | "gallery") {
        return Err(invalid_error(
            "El recorte previo sólo se aplica a videos o audio.",
        ));
    }
    let auto_route = request.auto_route.unwrap_or(false);
    if auto_route && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El enrutamiento automático sólo se aplica a videos.",
        ));
    }
    let delogo_enabled = request.delogo.unwrap_or(false);
    let manual_delogo = delogo_enabled.then_some(request.delogo_rect).flatten();
    if let Some(rect) = manual_delogo {
        if !rect.x.is_finite()
            || !rect.y.is_finite()
            || !rect.w.is_finite()
            || !rect.h.is_finite()
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.w <= 0.0
            || rect.h <= 0.0
            || rect.x + rect.w > 1.0001
            || rect.y + rect.h > 1.0001
        {
            return Err(invalid_error(
                "El rectángulo del logo debe estar dentro del cuadro (fracciones 0–1).",
            ));
        }
    }
    let delogo_corner_value = if delogo_enabled {
        Some(
            delogo_corner(request.delogo_corner.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let upscale_enabled = request.upscale.unwrap_or(false);
    let upscale_mode_value = if upscale_enabled {
        let mode = request
            .upscale_target
            .as_deref()
            .unwrap_or("auto")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            mode.as_str(),
            "auto" | "1080" | "2160" | "full-hd" | "fhd" | "4k" | "uhd"
        ) {
            return Err(invalid_error(
                "El objetivo de escalado debe ser auto, 1080 o 2160.",
            ));
        }
        Some(mode)
    } else {
        None
    };
    if (delogo_enabled || upscale_enabled) && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El delogo y el escalado sólo se aplican a videos.",
        ));
    }
    let source_title = request.source_title.clone().unwrap_or_default();
    let source_duration = request.source_duration.unwrap_or(0.0);
    let route_decision =
        auto_route.then(|| AutoRouteDecision::pick(source_duration, &source_title));
    let long_video = route_decision
        .map(|route| route.long_video)
        .unwrap_or(source_duration > 60.0);
    let explicit_voice = request.voice_pipeline.unwrap_or(false);
    let mut voice_script = request.voice_script.clone().unwrap_or_default();
    if auto_route && voice_script.trim().is_empty() {
        voice_script = "Narración automática de Olyvia.".to_owned();
    }
    if explicit_voice && !auto_route && voice_script.trim().is_empty() {
        return Err(invalid_error(
            "Escribí el guion para la voz IA local antes de descargar.",
        ));
    }
    // La voz ya no es automática: el enrutador conserva y masteriza el audio
    // original del video corto. Piper sólo se usa si se pidió explícitamente.
    let voice_enabled = explicit_voice && !voice_script.trim().is_empty();
    let auto_pipeline = request.auto_pipeline.unwrap_or(false) || voice_enabled || auto_route;
    let has_replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let audio_speed_noise = if let Some(route) = route_decision {
        route.speed_and_noise() && !has_replacement_audio && !voice_enabled
    } else {
        request.audio_speed_noise.unwrap_or(false)
    };
    let cinematic =
        request.cinematic.unwrap_or(false) || auto_pipeline || delogo_enabled || upscale_enabled;
    let watermark_enabled = request.watermark.unwrap_or(auto_route || voice_enabled);
    let cinematic_focus_value = if cinematic {
        Some(
            cinematic_focus(request.cinematic_focus.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if cinematic && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El look cinematográfico sólo se aplica a videos. Elegí un video o desactivalo.",
        ));
    }
    if cinematic && format != "mp4" {
        return Err(invalid_error(
            "El look cinematográfico exporta MP4. Elegí MP4 o desactivalo.",
        ));
    }
    let compression_allowed = !audio_only && matches!(format, "mp4");
    if (requested_crf.is_some() || request.target_size_mb.is_some()) && !compression_allowed {
        return Err(invalid_error(
            "La compresión sólo se aplica al formato MP4. Elegí MP4 o desactivá la compresión.",
        ));
    }
    let target_size_mb = request
        .target_size_mb
        .filter(|mb| *mb >= 5)
        .map(|mb| mb.min(100_000));
    if request.target_size_mb.is_some() && target_size_mb.is_none() {
        return Err(invalid_error(
            "El tamaño objetivo debe ser de al menos 5 MB.",
        ));
    }
    let should_compress =
        compression_allowed && !cinematic && (requested_crf.is_some() || target_size_mb.is_some());
    let crf = if should_compress { requested_crf } else { None };
    let filename_template = request.filename_template.clone();
    let audio_language = audio_language(request.audio_language.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let audio_format_id = request
        .audio_format_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if valid_format_id(value) {
                Ok(value.to_owned())
            } else {
                Err(invalid_error("El format_id de audio no es válido."))
            }
        })
        .transpose()?;
    let playlist_items = playlist_items(request.playlist_items.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let max_height = request
        .max_height
        .unwrap_or(MAX_HEIGHT)
        .clamp(144, MAX_HEIGHT);
    let playlist = request.playlist.unwrap_or(false);

    Ok(DownloadPlan {
        kind: kind.to_owned(),
        format: format.to_owned(),
        audio_only,
        codec: codec.to_owned(),
        hdr_mode: hdr_mode.to_owned(),
        quality: quality.to_owned(),
        max_height,
        proxy: proxy.map(str::to_owned),
        limit_rate: limit_rate.map(str::to_owned),
        download_subtitles,
        subtitle_langs,
        download_thumbnail,
        download_chapters,
        sponsorblock,
        sponsorblock_categories,
        sponsorblock_mark,
        sponsorblock_mute,
        trim_start,
        trim_end,
        cookies_from_browser,
        playlist,
        playlist_items,
        audio_language,
        audio_format_id,
        filename_template,
        requested_crf,
        target_size_mb,
        compression_allowed,
        should_compress,
        crf,
        cinematic,
        cinematic_focus: cinematic_focus_value,
        auto_pipeline,
        delogo_corner: delogo_corner_value,
        manual_delogo,
        upscale_mode: upscale_mode_value,
        keep_original,
        auto_route,
        route_decision,
        source_title,
        source_duration,
        long_video,
        voice_enabled,
        voice_script,
        replacement_audio,
        has_replacement_audio,
        audio_speed_noise,
        watermark_enabled,
    })
}

#[cfg(test)]
#[path = "download_plan.tests.rs"]
mod tests;
