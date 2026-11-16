//! Analizador de canales de YouTube — DTOs IPC, normalización de datos de
//! yt-dlp y heurísticas locales (keywords, sentimiento, flags de título,
//! patrones). No usa LLM: el ranking y los patrones son reglas medibles.
//!
//! Este módulo es puro: la ejecución de yt-dlp, la descarga de miniaturas y
//! los comandos Tauri viven en `commands::downloader::youtube_analytics`.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const DEFAULT_LISTED: u32 = 25;
pub const MAX_LISTED: u32 = 100;
pub const DEFAULT_DETAILS: u32 = 12;
pub const MAX_DETAILS: u32 = 24;
pub const DEFAULT_COMMENT_VIDEOS: u32 = 3;
pub const MAX_COMMENT_VIDEOS: u32 = 5;
pub const MAX_COMMENTS_PER_VIDEO: u32 = 40;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct ChannelAnalysisRequest {
    pub channel_url: String,
    pub max_videos: Option<u32>,
    pub detail_count: Option<u32>,
    pub include_comments: Option<bool>,
    pub comment_videos: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProgress {
    pub stage: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailStats {
    pub width: u32,
    pub height: u32,
    pub brightness: f64,
    pub saturation: f64,
    pub contrast: f64,
    pub palette: Vec<String>,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordCount {
    pub keyword: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopComment {
    pub author: String,
    pub text: String,
    pub likes: u64,
    pub video_title: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommentAnalysis {
    pub analyzed: u32,
    pub positive_percent: f64,
    pub negative_percent: f64,
    pub neutral_percent: f64,
    pub keywords: Vec<KeywordCount>,
    pub top_comments: Vec<TopComment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelVideo {
    pub id: String,
    pub title: String,
    pub url: String,
    pub views: u64,
    pub likes: Option<u64>,
    pub comments: Option<u64>,
    pub duration_seconds: f64,
    pub upload_date: Option<String>,
    pub views_per_day: f64,
    pub engagement_rate: f64,
    pub score: f64,
    pub title_flags: Vec<String>,
    pub reasons: Vec<String>,
    pub thumbnail_url: Option<String>,
    pub thumbnail: Option<ThumbnailStats>,
    pub comment_analysis: Option<CommentAnalysis>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitlePatterns {
    pub numbers_percent: f64,
    pub questions_percent: f64,
    pub how_to_percent: f64,
    pub lists_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailAverages {
    pub brightness: f64,
    pub saturation: f64,
    pub contrast: f64,
    pub samples: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInsights {
    pub median_views: u64,
    pub average_engagement: f64,
    pub uploads_per_week: f64,
    pub best_weekday: Option<String>,
    pub best_hour_utc: Option<u32>,
    pub median_duration_seconds: f64,
    pub common_title_words: Vec<KeywordCount>,
    pub title_patterns: TitlePatterns,
    pub thumbnail_average: Option<ThumbnailAverages>,
    pub comments: Option<CommentAnalysis>,
    pub strengths: Vec<String>,
    pub opportunities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelReport {
    pub channel_name: String,
    pub channel_url: String,
    pub subscribers: Option<u64>,
    pub listed_videos: u32,
    pub analyzed_videos: u32,
    pub total_videos: Option<u64>,
    pub best_video_id: String,
    pub best_reason_summary: String,
    pub videos: Vec<ChannelVideo>,
    pub insights: ChannelInsights,
    pub warnings: Vec<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone)]
pub struct RawVideo {
    pub id: String,
    pub title: String,
    pub views: u64,
    pub duration: f64,
    pub thumbnail_url: Option<String>,
    pub likes: Option<u64>,
    pub comments: Option<u64>,
    pub timestamp: Option<i64>,
    pub upload_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawComment {
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub like_count: u64,
}

// ---------------------------------------------------------------------------
// Normalización (antes `youtube_analytics/normalize.rs`)
// ---------------------------------------------------------------------------

pub fn normalize_channel_url(raw: &str) -> Result<String, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "pegá la URL del canal de YouTube",
        ));
    }
    let candidate = if trimmed.starts_with('@') {
        format!("https://www.youtube.com/{trimmed}")
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_owned()
    } else if trimmed.contains("youtube.com") || trimmed.contains("youtu.be") {
        format!("https://{trimmed}")
    } else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser de youtube.com",
        ));
    };
    let lower = candidate.to_ascii_lowercase();
    if !lower.contains("youtube.com/") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser de un canal de youtube.com",
        ));
    }
    if lower.contains("watch?") || lower.contains("youtu.be/") || lower.contains("/shorts/") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "pegá la URL del canal, no la de un video",
        ));
    }
    Ok(candidate)
}

pub fn parse_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
}

pub fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_u64().map(|number| number as f64))
}

pub fn text_of(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

pub fn best_thumbnail(value: &Value) -> Option<String> {
    if let Some(thumbnail) = text_of(value, "thumbnail") {
        return Some(thumbnail);
    }
    let mut best: Option<(u64, String)> = None;
    for thumb in value
        .get("thumbnails")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        let Some(url) = thumb.get("url").and_then(|item| item.as_str()) else {
            continue;
        };
        let width = parse_u64(&thumb["width"]).unwrap_or(0);
        if best
            .as_ref()
            .map(|(known, _)| width > *known)
            .unwrap_or(true)
        {
            best = Some((width, url.to_owned()));
        }
    }
    best.map(|(_, url)| url)
}

pub fn normalize_date(value: &str) -> Option<String> {
    if value.len() != 8 || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{}",
        &value[0..4],
        &value[4..6],
        &value[6..8]
    ))
}

pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

pub fn weekday_name(epoch: i64) -> String {
    const NAMES: [&str; 7] = [
        "lunes",
        "martes",
        "miércoles",
        "jueves",
        "viernes",
        "sábado",
        "domingo",
    ];
    let days = epoch.div_euclid(86_400);
    let index = (days + 3).rem_euclid(7) as usize;
    NAMES[index].to_owned()
}

pub fn date_from_epoch(epoch: i64) -> String {
    let (year, month, day) = civil_from_days(epoch.div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

pub fn epoch_from_upload_date(value: &str) -> Option<i64> {
    let normalized = if value.len() == 10 && value.as_bytes().get(4) == Some(&b'-') {
        value.to_owned()
    } else {
        normalize_date(value)?
    };
    let year: i64 = normalized[0..4].parse().ok()?;
    let month: i64 = normalized[5..7].parse().ok()?;
    let day: i64 = normalized[8..10].parse().ok()?;
    Some(days_from_civil(year, month, day) * 86_400)
}

pub fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Heurísticas de contenido (antes `youtube_analytics/analysis.rs`)
// ---------------------------------------------------------------------------

pub fn title_flags(title: &str) -> Vec<String> {
    let lower = title.to_lowercase();
    let normalized = lower.trim_start_matches(|ch: char| !ch.is_alphanumeric());
    let mut flags = Vec::new();
    if title.chars().any(|ch| ch.is_ascii_digit()) {
        flags.push("número".to_owned());
    }
    if title.contains('?') || title.contains('¿') {
        flags.push("pregunta".to_owned());
    }
    if normalized.starts_with("cómo")
        || normalized.starts_with("como ")
        || normalized.starts_with("how to")
        || lower.contains("tutorial")
    {
        flags.push("tutorial".to_owned());
    }
    if title.contains('|') || title.contains(" vs ") || title.contains(" / ") {
        flags.push("comparación/lista".to_owned());
    }
    if [
        "mejor", "peor", "nunca", "secreto", "error", "todo", "nadie", "jamás",
    ]
    .iter()
    .any(|word| lower.contains(word))
    {
        flags.push("curiosidad".to_owned());
    }
    flags
}

pub fn word_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'')
        .map(|word| word.trim_matches('\'').to_owned())
        .filter(|word| word.chars().count() >= 4)
        .collect()
}

pub fn stopwords() -> HashSet<&'static str> {
    [
        "para", "pero", "porque", "como", "cuando", "donde", "sobre", "entre", "desde", "hasta",
        "también", "tambien", "muy", "más", "mas", "este", "esta", "esto", "estos", "estas", "the",
        "and", "that", "this", "with", "from", "have", "your", "you", "about", "they", "their",
        "what", "when", "where", "will", "would", "there", "here", "http", "https", "www", "com",
        "video", "videos", "youtube",
    ]
    .into_iter()
    .collect()
}

pub fn keyword_counts(texts: &[String], limit: usize) -> Vec<KeywordCount> {
    let stop = stopwords();
    let mut counts: HashMap<String, u32> = HashMap::new();
    for text in texts {
        for word in word_tokens(text) {
            if stop.contains(word.as_str()) {
                continue;
            }
            *counts.entry(word).or_insert(0) += 1;
        }
    }
    let mut items: Vec<KeywordCount> = counts
        .into_iter()
        .map(|(keyword, count)| KeywordCount { keyword, count })
        .collect();
    items.sort_by(|a, b| b.count.cmp(&a.count).then(a.keyword.cmp(&b.keyword)));
    items.truncate(limit);
    items
}

pub fn sentiment(comment: &str) -> i32 {
    let words = word_tokens(comment);
    let positive = [
        "buen",
        "buena",
        "excelente",
        "increíble",
        "increible",
        "gracias",
        "genial",
        "perfecto",
        "útil",
        "util",
        "aprendí",
        "aprendi",
        "gran",
        "encanta",
        "encantó",
        "love",
        "great",
        "awesome",
        "thanks",
        "helpful",
        "best",
        "amazing",
        "nice",
        "excellent",
        "cool",
        "brilliant",
    ];
    let negative = [
        "malo",
        "mala",
        "aburrido",
        "error",
        "confuso",
        "pésimo",
        "pesimo",
        "horrible",
        "odio",
        "decepcion",
        "decepción",
        "bad",
        "boring",
        "wrong",
        "confusing",
        "hate",
        "terrible",
        "worst",
        "useless",
        "trash",
        "scam",
    ];
    let mut score = 0;
    for word in words {
        if positive.iter().any(|item| word.starts_with(item)) {
            score += 1;
        }
        if negative.iter().any(|item| word.starts_with(item)) {
            score -= 1;
        }
    }
    score
}

pub fn analyze_comments(comments: &[RawComment], comment_video_titles: &[String]) -> CommentAnalysis {
    if comments.is_empty() {
        return CommentAnalysis::default();
    }
    let mut positive = 0u32;
    let mut negative = 0u32;
    for comment in comments {
        match sentiment(&comment.text) {
            value if value > 0 => positive += 1,
            value if value < 0 => negative += 1,
            _ => {}
        }
    }
    let total = comments.len() as f64;
    let neutral = comments.len() as u32 - positive - negative;
    let keywords = keyword_counts(
        &comments
            .iter()
            .map(|comment| comment.text.clone())
            .collect::<Vec<_>>(),
        8,
    );
    let mut top: Vec<TopComment> = comments
        .iter()
        .enumerate()
        .filter(|(_, comment)| !comment.text.trim().is_empty())
        .map(|(index, comment)| TopComment {
            author: comment.author.chars().take(60).collect(),
            text: comment.text.chars().take(500).collect(),
            likes: comment.like_count,
            video_title: comment_video_titles.get(index).cloned().unwrap_or_default(),
        })
        .collect();
    top.sort_by_key(|comment| std::cmp::Reverse(comment.likes));
    top.truncate(5);
    CommentAnalysis {
        analyzed: comments.len() as u32,
        positive_percent: (f64::from(positive) / total * 1000.0).round() / 10.0,
        negative_percent: (f64::from(negative) / total * 1000.0).round() / 10.0,
        neutral_percent: (f64::from(neutral) / total * 1000.0).round() / 10.0,
        keywords,
        top_comments: top,
    }
}

// --------------------------------------------------------------------------- //
// Parsers de la salida de yt-dlp
// --------------------------------------------------------------------------- //

/// Parsea el listado `--flat-playlist --dump-single-json` del canal.
pub fn parse_listing(payload: &Value) -> (Vec<RawVideo>, Option<u64>, Option<u64>) {
    let mut videos = Vec::new();
    for entry in payload
        .get("entries")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        let Some(id) = text_of(entry, "id") else {
            continue;
        };
        if id.len() != 11 {
            continue;
        }
        let title = text_of(entry, "title").unwrap_or_else(|| id.clone());
        videos.push(RawVideo {
            id: id.clone(),
            title,
            views: parse_u64(&entry["view_count"]).unwrap_or(0),
            duration: parse_f64(&entry["duration"]).unwrap_or(0.0),
            thumbnail_url: best_thumbnail(entry),
            likes: None,
            comments: None,
            timestamp: entry["timestamp"].as_i64(),
            upload_date: text_of(entry, "upload_date").and_then(|value| normalize_date(&value)),
        });
    }
    let subscribers = parse_u64(&payload["channel_follower_count"]);
    let total = parse_u64(&payload["playlist_count"]);
    (videos, subscribers, total)
}

/// Parsea el detalle `--dump-single-json --skip-download` de un video,
/// completando huecos con los datos del listado.
pub fn parse_detail(value: &Value, fallback: &RawVideo) -> RawVideo {
    let timestamp = value["timestamp"]
        .as_i64()
        .or_else(|| value["release_timestamp"].as_i64())
        .or_else(|| {
            text_of(value, "upload_date")
                .as_deref()
                .and_then(epoch_from_upload_date)
        });
    RawVideo {
        id: text_of(value, "id").unwrap_or_else(|| fallback.id.clone()),
        title: text_of(value, "title").unwrap_or_else(|| fallback.title.clone()),
        views: parse_u64(&value["view_count"]).unwrap_or(fallback.views),
        duration: parse_f64(&value["duration"])
            .filter(|duration| *duration > 0.0)
            .unwrap_or(fallback.duration),
        thumbnail_url: best_thumbnail(value).or_else(|| fallback.thumbnail_url.clone()),
        likes: parse_u64(&value["like_count"]),
        comments: parse_u64(&value["comment_count"]),
        timestamp,
        upload_date: text_of(value, "upload_date")
            .and_then(|date| normalize_date(&date))
            .or_else(|| timestamp.map(date_from_epoch))
            .or_else(|| fallback.upload_date.clone()),
    }
}

/// Extrae los comentarios del payload de yt-dlp (descarta textos vacíos).
pub fn parse_comments_payload(value: &Value) -> Vec<RawComment> {
    value
        .get("comments")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|comment| {
            let Ok(parsed) = serde_json::from_value::<RawComment>(comment.clone()) else {
                return None;
            };
            if parsed.text.trim().is_empty() {
                return None;
            }
            Some(parsed)
        })
        .collect()
}

// --------------------------------------------------------------------------- //
// Selección de la muestra y puntuación
// --------------------------------------------------------------------------- //

/// Elige los videos a detallar: los más vistos primero y completa con los más
/// nuevos (según el orden original del listado en `entry_ids`) y luego con el
/// resto hasta `detail_count`.
pub fn select_detail_videos(
    listed: &[RawVideo],
    entry_ids: &[String],
    detail_count: u32,
) -> Vec<RawVideo> {
    let detail_count = detail_count as usize;
    let mut by_views: Vec<RawVideo> = listed.to_vec();
    by_views.sort_by_key(|video| std::cmp::Reverse(video.views));
    let mut selected: Vec<RawVideo> = Vec::new();
    let mut seen = HashSet::new();
    let newest_limit = (detail_count / 2).max(1);
    let popular_limit = detail_count.saturating_sub(newest_limit.min(by_views.len()));
    for video in by_views.iter().take(popular_limit) {
        if seen.insert(video.id.clone()) {
            selected.push(video.clone());
        }
    }
    // Los más nuevos están primero en el listado original; se recuperan desde
    // los ids del payload para no depender del orden después de ordenar por
    // vistas.
    for id in entry_ids.iter().take(newest_limit) {
        if let Some(video) = listed.iter().find(|item| &item.id == id) {
            if seen.insert(id.clone()) {
                selected.push(video.clone());
            }
        }
    }
    if selected.len() < detail_count {
        for video in by_views.iter() {
            if selected.len() >= detail_count {
                break;
            }
            if seen.insert(video.id.clone()) {
                selected.push(video.clone());
            }
        }
    }
    selected.truncate(detail_count);
    selected
}

pub fn median(mut values: Vec<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let middle = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

pub fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Puntúa vistas/día, engagement y recencia (0–100) en cada video.
pub fn score_videos(videos: &mut [ChannelVideo], now: i64) {
    let max_views_per_day = videos
        .iter()
        .map(|video| video.views_per_day)
        .fold(0.0f64, f64::max);
    let max_engagement = videos
        .iter()
        .map(|video| video.engagement_rate)
        .fold(0.0f64, f64::max);
    let max_age = videos
        .iter()
        .filter_map(|video| video.upload_date.as_deref())
        .filter_map(epoch_from_upload_date)
        .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(1.0))
        .fold(1.0f64, f64::max);
    for video in videos.iter_mut() {
        let age = video
            .upload_date
            .as_deref()
            .and_then(epoch_from_upload_date)
            .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(0.1))
            .unwrap_or(max_age);
        video.views_per_day = (video.views as f64 / age * 10.0).round() / 10.0;
        video.engagement_rate = if video.views > 0 {
            ((video.likes.unwrap_or(0) + video.comments.unwrap_or(0) * 2) as f64
                / video.views as f64
                * 1000.0)
                .round()
                / 10.0
        } else {
            0.0
        };
        let recency = (1.0 - age / max_age).clamp(0.0, 1.0);
        let part_views = if max_views_per_day > 0.0 {
            video.views_per_day / max_views_per_day
        } else {
            0.0
        };
        let part_engagement = if max_engagement > 0.0 {
            video.engagement_rate / max_engagement
        } else {
            0.0
        };
        video.score =
            ((part_views * 45.0 + part_engagement * 35.0 + recency * 20.0) * 10.0).round() / 10.0;
    }
}

pub fn build_reasons(
    video: &ChannelVideo,
    insights: &ChannelInsights,
    median_views_per_day: f64,
    best: bool,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if median_views_per_day > 0.0 {
        let ratio = video.views_per_day / median_views_per_day;
        if ratio >= 1.3 {
            reasons.push(format!(
                "{:.1}× las vistas por día de la mediana del canal",
                ratio
            ));
        }
    }
    if insights.average_engagement > 0.0 {
        let diff = video.engagement_rate - insights.average_engagement;
        if diff.abs() >= 0.2 {
            reasons.push(format!(
                "Engagement {:.1}% ({:+.1} puntos vs la media {:.1}%)",
                video.engagement_rate, diff, insights.average_engagement
            ));
        }
    }
    if let Some(comments) = &video.comment_analysis {
        if comments.analyzed > 0 {
            reasons.push(format!(
                "{}% de comentarios positivos en {} analizados",
                comments.positive_percent, comments.analyzed
            ));
        }
    }
    if let Some(thumbnail) = &video.thumbnail {
        if let Some(average) = &insights.thumbnail_average {
            let bright = thumbnail.brightness - average.brightness;
            let sat = thumbnail.saturation - average.saturation;
            if bright.abs() >= 5.0 || sat.abs() >= 5.0 {
                reasons.push(format!(
                    "Miniatura {:+.0}% de brillo y {:+.0}% de saturación vs el promedio",
                    bright, sat
                ));
            }
        }
        reasons.push(format!(
            "Miniatura {}×{}",
            thumbnail.width, thumbnail.height
        ));
    }
    if !video.title_flags.is_empty() {
        reasons.push(format!("Título con {}", video.title_flags.join(", ")));
    }
    if video.duration_seconds >= 60.0 {
        reasons.push(format!("Duración {:.0} min", video.duration_seconds / 60.0));
    }
    if best && reasons.is_empty() {
        reasons.push("Mayor score combinado de vistas/día, engagement y recencia".to_owned());
    }
    reasons
}

// --------------------------------------------------------------------------- //
// Métricas agregadas del canal
// --------------------------------------------------------------------------- //

/// Construye los `ChannelVideo` a partir de los detalles de yt-dlp.
pub fn build_channel_videos(
    details: &[RawVideo],
    thumbnails: &HashMap<String, ThumbnailStats>,
    now: i64,
) -> Vec<ChannelVideo> {
    details
        .iter()
        .map(|video| {
            let age = video
                .timestamp
                .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(0.1))
                .unwrap_or(1.0);
            ChannelVideo {
                id: video.id.clone(),
                title: video.title.clone(),
                url: format!("https://www.youtube.com/watch?v={}", video.id),
                views: video.views,
                likes: video.likes,
                comments: video.comments,
                duration_seconds: round1(video.duration),
                upload_date: video.upload_date.clone(),
                views_per_day: round1(video.views as f64 / age),
                engagement_rate: 0.0,
                score: 0.0,
                title_flags: title_flags(&video.title),
                reasons: Vec::new(),
                thumbnail_url: video.thumbnail_url.clone(),
                thumbnail: thumbnails.get(&video.id).cloned(),
                comment_analysis: None,
            }
        })
        .collect()
}

/// Estadísticas agregadas del canal sobre la muestra analizada.
pub struct ChannelSampleStats {
    pub median_views: f64,
    pub average_engagement: f64,
    pub uploads_per_week: f64,
    pub best_weekday: Option<String>,
    pub best_hour_utc: Option<u32>,
    pub median_duration: f64,
    pub median_views_per_day: f64,
    pub common_title_words: Vec<KeywordCount>,
    pub title_patterns: TitlePatterns,
    pub thumbnail_average: Option<ThumbnailAverages>,
}

/// Calcula las métricas puras del canal a partir de detalles y videos ya
/// puntuados. `dates` son los timestamps de subida de los detalles.
pub fn compute_channel_stats(
    details: &[RawVideo],
    videos: &[ChannelVideo],
) -> ChannelSampleStats {
    let median_views = median(videos.iter().map(|video| video.views as f64).collect());
    let median_duration = median(videos.iter().map(|video| video.duration_seconds).collect());
    let median_views_per_day = median(videos.iter().map(|video| video.views_per_day).collect());
    let average_engagement = videos
        .iter()
        .map(|video| video.engagement_rate)
        .sum::<f64>()
        / videos.len() as f64;
    let dated: Vec<i64> = details.iter().filter_map(|video| video.timestamp).collect();
    let uploads_per_week = if dated.len() >= 2 {
        let min = *dated.iter().min().unwrap_or(&0);
        let max = *dated.iter().max().unwrap_or(&0);
        let weeks = ((max - min).max(1) as f64) / (86_400.0 * 7.0);
        round1(details.len() as f64 / weeks.max(0.1))
    } else {
        0.0
    };
    let mut weekday_counts: HashMap<String, u32> = HashMap::new();
    let mut hour_counts: HashMap<u32, u32> = HashMap::new();
    for epoch in &dated {
        *weekday_counts.entry(weekday_name(*epoch)).or_insert(0) += 1;
        *hour_counts
            .entry((epoch.rem_euclid(86_400) / 3_600) as u32)
            .or_insert(0) += 1;
    }
    let best_weekday = weekday_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(name, _)| name);
    let best_hour_utc = hour_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(hour, _)| hour);

    let titles: Vec<String> = videos.iter().map(|video| video.title.clone()).collect();
    let title_count = titles.len().max(1) as f64;
    let pct = |count: usize| round1(count as f64 / title_count * 100.0);
    let title_patterns = TitlePatterns {
        numbers_percent: pct(titles
            .iter()
            .filter(|title| title.chars().any(|ch| ch.is_ascii_digit()))
            .count()),
        questions_percent: pct(titles
            .iter()
            .filter(|title| title.contains('?') || title.contains('¿'))
            .count()),
        how_to_percent: pct(titles
            .iter()
            .filter(|title| {
                let lower = title.to_lowercase();
                lower.starts_with("cómo")
                    || lower.starts_with("como ")
                    || lower.starts_with("how to")
                    || lower.contains("tutorial")
            })
            .count()),
        lists_percent: pct(titles
            .iter()
            .filter(|title| title.contains('|') || title.contains(" vs ") || title.contains(" / "))
            .count()),
    };
    let common_title_words = keyword_counts(&titles, 8);
    let thumbnail_samples: Vec<&ThumbnailStats> = videos
        .iter()
        .filter_map(|video| video.thumbnail.as_ref())
        .collect();
    let thumbnail_average = if thumbnail_samples.is_empty() {
        None
    } else {
        let count = thumbnail_samples.len() as f64;
        Some(ThumbnailAverages {
            brightness: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.brightness)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            saturation: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.saturation)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            contrast: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.contrast)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            samples: thumbnail_samples.len() as u32,
        })
    };
    ChannelSampleStats {
        median_views,
        average_engagement,
        uploads_per_week,
        best_weekday,
        best_hour_utc,
        median_duration,
        median_views_per_day,
        common_title_words,
        title_patterns,
        thumbnail_average,
    }
}

/// Deriva fortalezas y oportunidades a partir de las estadísticas del canal.
pub fn derive_strengths_opportunities(
    stats: &ChannelSampleStats,
    best: &ChannelVideo,
    comments: Option<&CommentAnalysis>,
    include_comments: bool,
) -> (Vec<String>, Vec<String>) {
    let mut strengths = Vec::new();
    let mut opportunities = Vec::new();
    if best.views_per_day > stats.median_views_per_day * 1.5 && stats.median_views_per_day > 0.0 {
        strengths.push(format!(
            "El mejor video rinde {:.1}× las vistas por día de la mediana del canal.",
            best.views_per_day / stats.median_views_per_day
        ));
    }
    if stats.average_engagement >= 3.0 {
        strengths.push(format!(
            "Engagement medio alto: {:.1}% del canal.",
            stats.average_engagement
        ));
    } else if stats.average_engagement < 1.0 {
        opportunities.push(format!(
            "Engagement bajo: {:.1}%; probá llamados a comentar y preguntas al final.",
            stats.average_engagement
        ));
    }
    if stats.uploads_per_week >= 1.0 {
        strengths.push(format!(
            "Cadencia constante: {:.1} videos por semana en la muestra.",
            stats.uploads_per_week
        ));
    } else {
        opportunities.push(format!(
            "Cadencia baja: {:.1} videos por semana; una subida fija ayuda al algoritmo.",
            stats.uploads_per_week
        ));
    }
    if let Some(thumbnail) = &stats.thumbnail_average {
        if thumbnail.brightness >= 55.0 && thumbnail.saturation >= 35.0 {
            strengths.push(format!(
                "Miniaturas visibles: brillo {:.0}% y saturación {:.0}%.",
                thumbnail.brightness, thumbnail.saturation
            ));
        } else if thumbnail.brightness < 42.0 {
            opportunities.push(format!(
                "Miniaturas oscuras (brillo {:.0}%); probá fondos más claros o un borde.",
                thumbnail.brightness
            ));
        }
    }
    let patterns = &stats.title_patterns;
    if patterns.numbers_percent >= 30.0
        || patterns.questions_percent >= 25.0
        || patterns.how_to_percent >= 25.0
    {
        strengths.push(format!(
            "Títulos con gancho: números {:.0}%, preguntas {:.0}%, tutoriales {:.0}%.",
            patterns.numbers_percent, patterns.questions_percent, patterns.how_to_percent
        ));
    } else {
        opportunities.push(
            "Los títulos no usan números, preguntas ni formato tutorial de forma consistente."
                .to_owned(),
        );
    }
    if let Some(comments) = comments {
        if comments.positive_percent >= 60.0 {
            strengths.push(format!(
                "Comunidad positiva: {:.0}% de comentarios positivos en {} analizados.",
                comments.positive_percent, comments.analyzed
            ));
        }
        if comments.negative_percent >= 25.0 {
            opportunities.push(format!(
                "{}% de comentarios negativos; revisá los temas repetidos.",
                comments.negative_percent
            ));
        }
    } else if include_comments {
        opportunities.push(
            "No se pudieron analizar comentarios; el video puede tenerlos deshabilitados."
                .to_owned(),
        );
    }
    if stats.median_duration > 1_200.0 {
        opportunities.push(format!(
            "Duración mediana de {:.0} min; probá cortes cortos derivados para retención.",
            stats.median_duration / 60.0
        ));
    }
    if strengths.is_empty() {
        strengths.push(
            "La muestra tiene datos suficientes para comparar vistas, engagement y miniaturas."
                .to_owned(),
        );
    }
    if opportunities.is_empty() {
        opportunities.push(
            "Sin oportunidades obvias en la muestra; medí más videos para confirmar.".to_owned(),
        );
    }
    (strengths, opportunities)
}

// --------------------------------------------------------------------------- //
// Miniaturas
// --------------------------------------------------------------------------- //

/// Mide brillo, saturación, contraste, paleta y preview JPEG de una imagen.
pub fn thumbnail_from_bytes(bytes: &[u8]) -> Option<ThumbnailStats> {
    let image = image::load_from_memory(bytes).ok()?;
    let (width, height) = image.dimensions();
    let small = image.resize_exact(64, 64, image::imageops::FilterType::Triangle);
    let mut luma_sum = 0.0;
    let mut sat_sum = 0.0;
    let mut luma_values = Vec::with_capacity(64 * 64);
    let mut palette: HashMap<(u8, u8, u8), u32> = HashMap::new();
    for pixel in small.pixels() {
        let rgba = pixel.2;
        let [r, g, b, _] = rgba.0;
        let max = f64::from(r.max(g).max(b));
        let min = f64::from(r.min(g).min(b));
        let luma = (0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b)) / 255.0;
        let saturation = if max > 0.0 { (max - min) / max } else { 0.0 };
        luma_sum += luma;
        sat_sum += saturation;
        luma_values.push(luma);
        let bucket = (r >> 5, g >> 5, b >> 5);
        *palette.entry(bucket).or_insert(0) += 1;
    }
    let count = luma_values.len() as f64;
    let mean = luma_sum / count;
    let variance = luma_values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / count;
    let mut palette_items: Vec<((u8, u8, u8), u32)> = palette.into_iter().collect();
    palette_items.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    let palette = palette_items
        .into_iter()
        .take(3)
        .map(|((r, g, b), _)| {
            format!(
                "#{:02x}{:02x}{:02x}",
                (u32::from(r) * 32 + 16).min(255),
                (u32::from(g) * 32 + 16).min(255),
                (u32::from(b) * 32 + 16).min(255)
            )
        })
        .collect();
    let preview_image = image.resize_to_fill(320, 180, image::imageops::FilterType::Triangle);
    let mut preview_bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut preview_bytes, 78);
    encoder.encode_image(&preview_image).ok()?;
    let preview = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(preview_bytes)
    );
    Some(ThumbnailStats {
        width,
        height,
        brightness: (mean * 1000.0).round() / 10.0,
        saturation: (sat_sum / count * 1000.0).round() / 10.0,
        contrast: (variance.sqrt() * 1000.0).round() / 10.0,
        palette,
        preview,
    })
}
