use super::*;

fn branch(screen: Option<usize>, webcam: Option<usize>) -> TransitionBranch {
    TransitionBranch {
        screen,
        webcam,
        webcam_chroma: None,
    }
}

#[test]
fn defaults_produce_a_valid_fade() {
    let spec = ObsTransitionSpec::new(None, None, None, None, None, None, None).unwrap();
    assert_eq!(spec.kind, "fade");
    assert_eq!(spec.width, 1920);
    assert_eq!(spec.height, 1080);
    assert_eq!(spec.fps, 30);
    assert!((spec.total_secs() - 5.0).abs() < 1e-9);
}

#[test]
fn rejects_unknown_kind_and_bad_numbers() {
    assert!(
        ObsTransitionSpec::new(Some("morph".into()), None, None, None, None, None, None).is_err()
    );
    assert!(ObsTransitionSpec::new(None, Some(-1.0), None, None, None, None, None).is_err());
    assert!(ObsTransitionSpec::new(None, Some(f64::NAN), None, None, None, None, None).is_err());
    assert!(ObsTransitionSpec::new(None, None, Some(0.01), None, None, None, None).is_err());
    assert!(ObsTransitionSpec::new(None, None, Some(60.0), None, None, None, None).is_err());
    assert!(ObsTransitionSpec::new(None, None, None, Some(-0.5), None, None, None).is_err());
    assert!(ObsTransitionSpec::new(None, Some(4000.0), None, None, None, None, None).is_err());
    // total > 7200
    assert!(ObsTransitionSpec::new(
        None,
        Some(3600.0),
        Some(30.0),
        Some(3600.0),
        None,
        None,
        None
    )
    .is_err());
    assert!(ObsTransitionSpec::new(None, None, None, None, Some(8), None, None).is_err());
    assert!(ObsTransitionSpec::new(None, None, None, None, None, None, Some(0)).is_err());
    assert!(ObsTransitionSpec::new(None, None, None, None, None, None, Some(120)).is_err());
}

#[test]
fn screen_only_branches_normalize_and_xfade() {
    let spec = ObsTransitionSpec::new(
        Some("wipeleft".into()),
        Some(3.5),
        Some(0.8),
        Some(1.2),
        Some(1280),
        Some(720),
        Some(24),
    )
    .unwrap();
    let graph = spec
        .filtergraph(&branch(Some(0), None), &branch(Some(1), None))
        .unwrap();
    assert!(graph.contains("[0:v]scale=1280:720:force_original_aspect_ratio=decrease"));
    assert!(graph.contains("pad=1280:720:(ow-iw)/2:(oh-ih)/2"));
    assert!(graph.contains("setsar=1,fps=24,format=yuv420p,settb=AVTB[a]"));
    assert!(graph.contains("[1:v]scale=1280:720"));
    assert!(graph.contains("[a][b]xfade=transition=wipeleft:duration=0.8:offset=3.5[v]"));
}

#[test]
fn pip_branch_composes_screen_and_webcam() {
    let spec = ObsTransitionSpec::new(None, None, None, None, None, None, None).unwrap();
    let from = TransitionBranch {
        screen: Some(0),
        webcam: Some(1),
        webcam_chroma: Some("chromakey=0x00FF00:0.12:0.1,format=yuva420p".to_owned()),
    };
    let graph = spec.filtergraph(&from, &branch(Some(2), None)).unwrap();
    assert!(graph.contains("[0:v]scale=1920:1080"));
    assert!(graph
        .contains("[1:v]chromakey=0x00FF00:0.12:0.1,format=yuva420p,scale='min(320,iw)':-2[bwa]"));
    assert!(graph.contains("overlay=W-w-24:H-h-24"));
    assert!(graph.contains("[2:v]scale=1920:1080"));
    assert!(graph.contains("xfade=transition=fade"));
}

#[test]
fn pip_branch_without_chroma_has_no_dangling_comma() {
    let spec = ObsTransitionSpec::new(None, None, None, None, None, None, None).unwrap();
    let from = TransitionBranch {
        screen: Some(0),
        webcam: Some(1),
        webcam_chroma: None,
    };
    let graph = spec.filtergraph(&from, &branch(Some(2), None)).unwrap();
    assert!(graph.contains("[1:v]scale='min(320,iw)':-2[bwa]"));
    assert!(!graph.contains("[1:v],scale"));
    let solo = spec
        .filtergraph(&branch(None, Some(0)), &branch(Some(1), None))
        .unwrap();
    assert!(solo.contains("[0:v]scale=1920:1080"));
    assert!(!solo.contains("[0:v],scale"));
}

#[test]
fn webcam_only_branch_works_and_empty_branch_fails() {
    let spec = ObsTransitionSpec::new(None, None, None, None, None, None, None).unwrap();
    let graph = spec
        .filtergraph(&branch(None, Some(0)), &branch(Some(1), None))
        .unwrap();
    assert!(graph.contains("[0:v]scale=1920:1080"));
    assert!(spec
        .filtergraph(&branch(None, None), &branch(Some(1), None))
        .is_err());
    assert!(spec
        .filtergraph(&branch(Some(0), None), &branch(None, None))
        .is_err());
}

#[test]
fn total_arg_rounds_up_to_hundredths() {
    let spec =
        ObsTransitionSpec::new(None, Some(1.0), Some(0.5), Some(1.0), None, None, None).unwrap();
    assert_eq!(spec.total_arg(), "2.50");
    let odd =
        ObsTransitionSpec::new(None, Some(1.0), Some(0.333), Some(1.0), None, None, None).unwrap();
    assert_eq!(odd.total_arg(), "2.34");
}

#[test]
fn every_listed_kind_builds_a_graph() {
    for kind in TRANSITION_KINDS {
        let spec = ObsTransitionSpec::new(Some((*kind).into()), None, None, None, None, None, None)
            .unwrap();
        let graph = spec
            .filtergraph(&branch(Some(0), None), &branch(Some(1), None))
            .unwrap();
        assert!(graph.contains(&format!("transition={kind}")));
    }
}
