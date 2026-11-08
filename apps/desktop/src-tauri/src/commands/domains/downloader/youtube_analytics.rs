//! Analizador de canales de YouTube.
//!
//! Usa el yt-dlp ya gestionado por la app para listar el canal y leer metadatos
//! públicos: vistas, likes, comentarios, duración, fecha, miniatura y título.
//! No usa LLM: el ranking, el sentimiento y los patrones de título son
//! heurísticas locales medibles.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::downloader::resolve_engine;
use crate::commands::hide_console;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const DEFAULT_LISTED: u32 = 25;
const MAX_LISTED: u32 = 100;
const DEFAULT_DETAILS: u32 = 12;
const MAX_DETAILS: u32 = 24;
const DEFAULT_COMMENT_VIDEOS: u32 = 3;
const MAX_COMMENT_VIDEOS: u32 = 5;
const MAX_COMMENTS_PER_VIDEO: u32 = 40;

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
struct RawVideo {
    id: String,
    title: String,
    views: u64,
    duration: f64,
    thumbnail_url: Option<String>,
    likes: Option<u64>,
    comments: Option<u64>,
    timestamp: Option<i64>,
    upload_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawComment {
    #[serde(default)]
    author: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    like_count: u64,
}

fn provider_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

fn emit_progress(app: Option<&AppHandle>, stage: &str, current: u32, total: u32, message: &str) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "channel-analysis-progress",
        ChannelProgress {
            stage: stage.to_owned(),
            current,
            total,
            message: message.to_owned(),
        },
    );
}

include!("youtube_analytics/normalize.rs");
include!("youtube_analytics/engine.rs");
include!("youtube_analytics/analysis.rs");
include!("youtube_analytics/thumbnails.rs");
include!("youtube_analytics/channel.rs");

#[tauri::command]
pub async fn analyze_youtube_channel(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChannelAnalysisRequest,
) -> Result<ChannelReport, ProjectError> {
    let config_dir = state.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        analyze_channel_blocking(Some(&app), &config_dir, request)
    })
    .await
    .map_err(|error| provider_error(&format!("el analizador de canales falló: {error}")))?
}
#[cfg(test)]
#[path = "youtube_analytics.live_tests.rs"]
mod live_tests;
#[cfg(test)]
#[path = "youtube_analytics.tests.rs"]
mod tests;
