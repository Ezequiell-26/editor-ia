use super::*;
use std::path::PathBuf;

/// Prueba de red real, desactivada salvo que se pida explícitamente.
#[test]
fn live_channel_analysis_optional() {
    if std::env::var("EDITOR_IA_RUN_NETWORK_TESTS").ok().as_deref() != Some("1") {
        eprintln!("live_channel_analysis omitido: definí EDITOR_IA_RUN_NETWORK_TESTS=1");
        return;
    }
    let config =
        PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("com.editoria.desktop");
    let report = analyze_channel_blocking(
        None,
        &config,
        ChannelAnalysisRequest {
            channel_url: "https://www.youtube.com/@Computerphile/videos".to_owned(),
            max_videos: Some(5),
            detail_count: Some(3),
            include_comments: Some(true),
            comment_videos: Some(1),
        },
    )
    .expect("el canal debería analizarse");
    assert!(!report.channel_name.is_empty());
    assert!(!report.best_video_id.is_empty());
    assert!(!report.videos.is_empty());
    assert!(report.videos.iter().any(|video| video.thumbnail.is_some()));
    assert!(report.insights.comments.is_some());
    eprintln!(
        "canal {} · {} videos · mejor {} · score {:.0} · comentarios {}",
        report.channel_name,
        report.analyzed_videos,
        report.best_video_id,
        report.videos[0].score,
        report
            .insights
            .comments
            .as_ref()
            .map(|c| c.analyzed)
            .unwrap_or(0)
    );
}
