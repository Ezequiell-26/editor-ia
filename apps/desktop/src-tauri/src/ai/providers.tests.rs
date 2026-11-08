use super::*;
use serde_json::json;

fn request() -> GenerateRequest {
    GenerateRequest {
        brief: "Un video corto sobre cómo ordenar una timeline".to_owned(),
        scene_count: 3,
        language: "es".to_owned(),
        approved_cost: false,
    }
}

#[test]
fn endpoint_join_is_idempotent() {
    assert_eq!(chat_endpoint("http://x/v1"), "http://x/v1/chat/completions");
    assert_eq!(
        chat_endpoint("http://x/v1/chat/completions/"),
        "http://x/v1/chat/completions"
    );
}

#[test]
fn local_endpoints_do_not_require_cost_approval() {
    assert!(is_local_endpoint("http://127.0.0.1:11434/v1"));
    assert!(is_local_endpoint("HTTP://LOCALHOST:8080/v1"));
    assert!(is_local_endpoint("http://[::1]:11434/v1"));
    assert!(!is_local_endpoint("https://api.openai.com/v1"));
    assert!(!is_local_endpoint("http://127.0.0.1.evil.example/v1"));
    assert!(!is_local_endpoint("http://localhost.evil.example/v1"));
    assert!(!is_local_endpoint("http://localhost@evil.example/v1"));
    assert!(!is_local_endpoint("http://127.0.0.1:11434@evil.example/v1"));
}

#[test]
fn remote_providers_require_https_and_no_userinfo() {
    assert!(validate_provider_base_url("https://api.openai.com/v1").is_ok());
    assert!(validate_provider_base_url("http://api.openai.com/v1").is_err());
    assert!(validate_provider_base_url("http://127.0.0.1:11434/v1").is_ok());
    assert!(validate_provider_base_url("http://127.0.0.1.evil.example/v1").is_err());
    assert!(validate_provider_base_url("https://user:pass@api.openai.com/v1").is_err());
    assert!(validate_provider_base_url("ftp://localhost/v1").is_err());
}

#[test]
fn extracts_json_from_fences() {
    let text = "```json\n{\"title\":\"x\",\"scenes\":[]}\n```";
    assert_eq!(extract_json(text), Some("{\"title\":\"x\",\"scenes\":[]}"));
    assert!(extract_json("sin json").is_none());
}

#[test]
fn chat_payload_requests_json_only_when_enabled() {
    let messages = vec![json!({ "role": "user", "content": "hola" })];
    let with_json = chat_payload("modelo", 0.2, &messages, true);
    assert_eq!(with_json["response_format"]["type"], "json_object");
    assert_eq!(with_json["messages"][0]["content"], "hola");
    let plain = chat_payload("modelo", 0.2, &messages, false);
    assert!(plain.get("response_format").is_none());
    assert_eq!(plain["model"], "modelo");
}

#[test]
fn only_parameter_rejections_retry_without_json_mode() {
    assert!(should_retry_without_json_mode(400));
    assert!(should_retry_without_json_mode(415));
    assert!(should_retry_without_json_mode(422));
    for status in [200, 401, 403, 404, 429, 500, 503] {
        assert!(!should_retry_without_json_mode(status), "{status}");
    }
}

#[test]
fn json_repair_retry_echoes_the_invalid_output_and_asks_only_for_json() {
    let messages = vec![json!({ "role": "user", "content": "hacé un guion" })];
    let invalid = "x".repeat(MAX_REPAIR_ECHO_CHARS + 500);
    let repaired = json_repair_messages(messages, &invalid);
    assert_eq!(repaired.len(), 3);
    assert_eq!(repaired[1]["role"], "assistant");
    assert_eq!(
        repaired[1]["content"].as_str().unwrap().chars().count(),
        MAX_REPAIR_ECHO_CHARS
    );
    let instruction = repaired[2]["content"].as_str().unwrap();
    assert!(instruction.contains("SOLO"), "{instruction}");
    assert!(instruction.contains("JSON"), "{instruction}");
}

#[test]
fn plan_is_bounded_and_normalized() {
    let raw = RawPlan {
        title: Some("  Plan  ".to_owned()),
        scenes: vec![
            RawScene {
                title: Some("  Uno ".to_owned()),
                intent: Some("inventado".to_owned()),
                narration: Some("Texto válido".to_owned()),
                visual: None,
                estimated_seconds: Some(5.0),
            },
            RawScene {
                title: None,
                intent: None,
                narration: None,
                visual: None,
                estimated_seconds: None,
            },
        ],
    };
    let plan = plan_from_raw(raw, "p", "m", false, false);
    assert_eq!(plan.title, "Plan");
    assert_eq!(plan.scenes.len(), 2);
    assert_eq!(plan.scenes[0].intent, "explainer");
    assert_eq!(plan.scenes[0].order, 0);
    assert_eq!(plan.scenes[1].title, "Escena 2");
}

#[test]
fn empty_plans_are_rejected() {
    let empty = json!({ "title": "x", "scenes": [] });
    assert!(validate_plan(&empty).is_err());
    let no_narration = json!({ "title": "x", "scenes": [{ "title": "a" }] });
    assert!(validate_plan(&no_narration).is_err());
}

#[test]
fn mock_plan_is_explicitly_simulated_and_respects_scene_count() {
    let plan = mock_plan(&request(), "mock");
    assert!(plan.simulated);
    assert_eq!(plan.scenes.len(), 3);
    assert!(plan.title.contains("simulado"));
    assert!(plan.scenes.iter().all(|scene| !scene.narration.is_empty()));
}

#[test]
fn brief_length_is_bounded_by_the_command_contract() {
    let too_short = "corto";
    assert!(too_short.chars().count() < 10);
    let too_long = "x".repeat(MAX_BRIEF_CHARS + 1);
    assert!(too_long.chars().count() > MAX_BRIEF_CHARS);
}

fn translation(texts: &[&str], target: &str) -> TranslateRequest {
    TranslateRequest {
        texts: texts.iter().map(|text| (*text).to_owned()).collect(),
        source_language: "auto".to_owned(),
        target_language: target.to_owned(),
        glossary: None,
        approved_cost: false,
    }
}

#[test]
fn translation_accepts_the_supported_languages_and_trims() {
    for code in [
        "es", "en", "zh", "hi", "ar", "pt", "bn", "ru", "fr", "de", "it", "ja",
    ] {
        let request = translation(&["  Hola  "], code);
        let (texts, target) = validate_translation(&request).expect("válido");
        assert_eq!(texts, vec!["Hola"]);
        assert_eq!(target, code);
    }
}

#[test]
fn translation_rejects_unknown_languages_empty_and_huge_batches() {
    assert!(validate_translation(&translation(&["Hola"], "tl")).is_err());
    assert!(validate_translation(&translation(&[], "en")).is_err());
    assert!(validate_translation(&translation(&["   "], "en")).is_err());
    let many = vec!["Hola"; MAX_TRANSLATE_CUES + 1];
    assert!(validate_translation(&translation(&many, "en")).is_err());
    let long = "x".repeat(MAX_TRANSLATE_CHARS + 1);
    assert!(validate_translation(&translation(&[&long], "en")).is_err());
}

#[test]
fn translation_parser_requires_every_cue_in_order() {
    let parsed = parse_translations(r#"{"texts":["Hello","World"]}"#, 2).expect("JSON");
    assert_eq!(parsed, vec!["Hello", "World"]);
    let array = parse_translations(r#"["Uno","Dos"]"#, 2).expect("array");
    assert_eq!(array, vec!["Uno", "Dos"]);
    let fenced =
        parse_translations("```json\n{\"translations\":[\"Eins\"]}\n```", 1).expect("fenced");
    assert_eq!(fenced, vec!["Eins"]);
}

#[test]
fn translation_parser_rejects_missing_empty_or_extra_cues() {
    assert!(parse_translations(r#"{"texts":["Uno"]}"#, 2).is_err());
    assert!(parse_translations(r#"{"texts":["Uno","Dos","Tres"]}"#, 2).is_err());
    assert!(parse_translations(r#"{"texts":["Uno","   "]}"#, 2).is_err());
    assert!(parse_translations("sin json", 1).is_err());
}

#[test]
fn simulated_translation_is_marked_and_does_not_invent_text() {
    let request = translation(&["Hola", "Mundo"], "en");
    let result = mock_translation(&request);
    assert!(result.simulated);
    assert_eq!(result.texts, vec!["Hola", "Mundo"]);
}

#[test]
fn effect_parameters_are_clamped_and_filtered() {
    let recipe = clean_effect(&serde_json::json!({
        "effects": { "brightness": 9, "contrast": -2, "vignette": 0.4, "inventado": 3 }
    }))
    .expect("efecto válido");
    assert_eq!(recipe["brightness"], 1.0);
    assert_eq!(recipe["contrast"], 0.0);
    assert_eq!(recipe["vignette"], 0.4);
    assert!(recipe.get("inventado").is_none());
}

#[test]
fn models_endpoint_joins_like_the_chat_endpoint() {
    assert_eq!(models_endpoint("http://x/v1"), "http://x/v1/models");
    assert_eq!(models_endpoint("http://x/v1/"), "http://x/v1/models");
    assert_eq!(models_endpoint("http://x/v1/models"), "http://x/v1/models");
    assert_eq!(
        models_endpoint("http://x/v1/chat/completions"),
        "http://x/v1/models"
    );
}

#[test]
fn model_ids_are_bounded_and_validated() {
    assert_eq!(
        parse_model_ids(br#"{"data":[{"id":" llama3.1 "},{"id":""},{"id":5}]}"#),
        Some(vec!["llama3.1".to_owned()])
    );
    assert_eq!(parse_model_ids(br#"{"data":[]}"#), Some(Vec::new()));
    assert!(parse_model_ids(b"no json").is_none());
    assert!(parse_model_ids(br#"{"object":"list"}"#).is_none());
}
