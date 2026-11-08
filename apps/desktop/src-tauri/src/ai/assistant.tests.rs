use super::*;
use serde_json::json;

#[test]
fn validates_navigation_and_motion_actions() {
    assert_eq!(
        clean_action(Some(&json!({ "kind": "navigate", "view": "editor" }))),
        Some(json!({ "kind": "navigate", "view": "editor" }))
    );
    assert!(clean_action(Some(&json!({ "kind": "navigate", "view": "ovnis" }))).is_none());
    let motion = clean_action(Some(&json!({
        "kind": "motion",
        "templateId": "lower-third",
        "text": "Ana",
        "secondary": "Editora"
    })))
    .expect("motion válido");
    assert_eq!(motion["templateId"], "lower-third");
    assert_eq!(motion["text"], "Ana");
    assert!(clean_action(Some(&json!({ "kind": "delete_everything" }))).is_none());
}

#[test]
fn editing_actions_validate_their_bounds() {
    assert_eq!(
        clean_action(Some(
            &json!({ "kind": "new_project", "name": "  Reel de mayo  " })
        )),
        Some(json!({ "kind": "new_project", "name": "Reel de mayo" }))
    );
    assert!(clean_action(Some(&json!({ "kind": "new_project", "name": "   " }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "import_file",
            "path": "C:\\Videos\\clip.mp4"
        }))),
        Some(json!({ "kind": "import_file", "path": "C:\\Videos\\clip.mp4" }))
    );
    // Sin ruta absoluta no pasa: el operador no adivina.
    assert!(clean_action(Some(&json!({
        "kind": "import_file",
        "path": "media/clip.mp4"
    })))
    .is_none());
    assert!(clean_action(Some(&json!({ "kind": "import_file" }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "download_url",
            "url": "https://youtu.be/x"
        }))),
        Some(json!({ "kind": "download_url", "url": "https://youtu.be/x" }))
    );
    assert!(clean_action(Some(&json!({
        "kind": "download_url",
        "url": "ftp://youtu.be/x"
    })))
    .is_none());

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "add_clip",
            "asset": " b-roll ",
            "atPlayhead": true
        }))),
        Some(json!({ "kind": "add_clip", "asset": "b-roll", "atPlayhead": true }))
    );
    assert!(clean_action(Some(&json!({ "kind": "add_clip", "asset": "" }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({ "kind": "goto", "seconds": 90.5 }))),
        Some(json!({ "kind": "goto", "seconds": 90.5 }))
    );
    assert!(clean_action(Some(&json!({ "kind": "goto", "seconds": -1 }))).is_none());
    assert!(clean_action(Some(&json!({ "kind": "goto", "seconds": 99_999 }))).is_none());

    let caption = clean_action(Some(&json!({
        "kind": "add_caption",
        "text": "Hola",
        "seconds": 0.1
    })))
    .expect("subtítulo válido");
    assert_eq!(
        caption["seconds"], 3.0,
        "un subtítulo de 0,1 s se lleva al mínimo"
    );

    assert_eq!(
        clean_action(Some(&json!({ "kind": "set_speed", "speed": 2 }))),
        Some(json!({ "kind": "set_speed", "speed": 2.0 }))
    );
    assert!(clean_action(Some(&json!({ "kind": "set_speed", "speed": 40 }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({ "kind": "set_gain", "db": -6 }))),
        Some(json!({ "kind": "set_gain", "db": -6.0 }))
    );
    assert!(clean_action(Some(&json!({ "kind": "set_gain", "db": 0 }))).is_none());
    assert!(clean_action(Some(&json!({ "kind": "set_gain", "db": 99 }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({ "kind": "mute_clip", "muted": true }))),
        Some(json!({ "kind": "mute_clip", "muted": true }))
    );
    assert!(clean_action(Some(&json!({ "kind": "mute_clip" }))).is_none());

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "cut_silences",
            "scope": "project",
            "thresholdDb": -40,
            "minSilenceSeconds": 0.5,
            "paddingSeconds": 0.1
        }))),
        Some(json!({
            "kind": "cut_silences",
            "thresholdDb": -40.0,
            "minSilenceSeconds": 0.5,
            "paddingSeconds": 0.1,
            "scope": "project"
        }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "cut_silences" }))),
        Some(json!({
            "kind": "cut_silences",
            "thresholdDb": -45.0,
            "minSilenceSeconds": 0.35,
            "paddingSeconds": 0.15,
            "scope": "selection"
        }))
    );
    // Un umbral imposible o un alcance desconocido caen a los valores por
    // defecto: el corte sigue siendo útil y acotado por la guardia del 80 %.
    assert_eq!(
        clean_action(Some(
            &json!({ "kind": "cut_silences", "thresholdDb": 5, "scope": "otro" })
        ))
        .unwrap()["thresholdDb"],
        json!(-45.0)
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "cut_silences", "scope": "otro" }))).unwrap()["scope"],
        json!("selection")
    );

    assert_eq!(
        clean_action(Some(
            &json!({ "kind": "auto_subtitles", "scope": "project" })
        )),
        Some(json!({ "kind": "auto_subtitles", "scope": "project" }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "auto_subtitles" }))).unwrap()["scope"],
        json!("selection")
    );

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "cut_voice_pauses",
            "scope": "project",
            "minPauseSeconds": 0.6,
            "paddingSeconds": 0.1
        }))),
        Some(json!({
            "kind": "cut_voice_pauses",
            "minPauseSeconds": 0.6,
            "paddingSeconds": 0.1,
            "scope": "project"
        }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "cut_voice_pauses" }))).unwrap(),
        json!({
            "kind": "cut_voice_pauses",
            "minPauseSeconds": 0.35,
            "paddingSeconds": 0.08,
            "scope": "selection"
        })
    );

    assert_eq!(
        clean_action(Some(&json!({
            "kind": "auto_cleanup",
            "denoise": "strong",
            "zoomCuts": false,
            "targetLufs": -16
        }))),
        Some(json!({
            "kind": "auto_cleanup",
            "denoise": "strong",
            "levelAudio": true,
            "zoomCuts": false,
            "cutSilences": true,
            "cutPauses": true,
            "targetLufs": -16.0
        }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "auto_cleanup" }))).unwrap()["denoise"],
        json!("medium")
    );

    assert_eq!(
        clean_action(Some(&json!({ "kind": "auto_pilot" }))),
        Some(json!({ "kind": "auto_pilot" }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "auto_pilot" }))),
        Some(json!({ "kind": "auto_pilot" }))
    );

    assert_eq!(
        clean_action(Some(&json!({ "kind": "split_at_playhead" }))),
        Some(json!({ "kind": "split_at_playhead" }))
    );
    assert_eq!(
        clean_action(Some(&json!({ "kind": "delete_selected" }))),
        Some(json!({ "kind": "delete_selected" }))
    );
}

#[test]
fn navigation_accepts_the_full_surface_of_the_app() {
    for view in [
        "sharpen",
        "lab",
        "creator",
        "mixer",
        "text-edit",
        "auto-edit",
    ] {
        assert_eq!(
            clean_action(Some(&json!({ "kind": "navigate", "view": view }))),
            Some(json!({ "kind": "navigate", "view": view }))
        );
    }
}

#[test]
fn match_assignments_validate_count_and_range() {
    assert_eq!(
        validate_assignments(&json!({ "assignments": [0, 2, 2] }), 3, 3).unwrap(),
        vec![0, 2, 2]
    );
    assert!(validate_assignments(&json!({ "assignments": [0, 1] }), 3, 3).is_err());
    assert!(validate_assignments(&json!({ "assignments": [0, 3, 1] }), 3, 3).is_err());
    assert!(validate_assignments(&json!({ "assignments": [0, "1", 1] }), 3, 3).is_err());
    assert!(validate_assignments(&json!({ "nope": [] }), 3, 3).is_err());
}

#[test]
fn media_folder_action_only_accepts_a_folder_name() {
    assert_eq!(
        clean_action(Some(
            &json!({ "kind": "media_folder", "folder": " video 1 " })
        )),
        Some(json!({ "kind": "media_folder", "folder": "video 1" }))
    );
    assert!(clean_action(Some(&json!({
        "kind": "media_folder",
        "folder": "..\\Windows"
    })))
    .is_none());
    assert!(clean_action(Some(&json!({
        "kind": "media_folder",
        "folder": "C:\\Users\\tester\\Downloads"
    })))
    .is_none());
    assert!(clean_action(Some(&json!({ "kind": "media_folder", "folder": "" }))).is_none());
}

#[test]
fn sanitizes_ordered_multi_action_plans_and_keeps_legacy_action() {
    let legacy = clean_actions(&json!({
        "action": { "kind": "navigate", "view": "editor" }
    }));
    assert_eq!(
        legacy,
        vec![json!({ "kind": "navigate", "view": "editor" })]
    );

    let actions = clean_actions(&json!({
        "actions": [
            { "kind": "navigate", "view": "editor" },
            { "kind": "navigate", "view": "motion" },
            { "kind": "unknown" },
            { "kind": "navigate", "view": "motion" },
            { "kind": "save" },
            { "kind": "undo" },
            { "kind": "redo" },
            { "kind": "export" }
        ],
        "action": { "kind": "pause" }
    }));
    assert_eq!(actions.len(), 5);
    assert_eq!(actions[0], json!({ "kind": "navigate", "view": "editor" }));
    assert_eq!(actions[1], json!({ "kind": "navigate", "view": "motion" }));
    assert_eq!(actions[2], json!({ "kind": "save" }));
    assert_eq!(actions[3], json!({ "kind": "undo" }));
    assert_eq!(actions[4], json!({ "kind": "redo" }));
    assert!(!actions.contains(&json!({ "kind": "pause" })));
}

#[test]
fn assistant_prompt_explains_compact_mcp_risk_hints() {
    let prompt = assistant_system_prompt("{}");
    assert!(prompt.contains("marcas h del catalogo"));
    assert!(prompt.contains("r=solo lectura"));
    assert!(prompt.contains("d=destructiva"));
    assert!(prompt.contains("o=efecto externo"));
}

#[test]
fn assistant_context_preserves_catalog_separately_from_project_limit() {
    let context = json!({
        "view": "editor",
        "brain": "CEREBRO DE EDICION",
        "mcpTools": [{
            "name": "app_status",
            "description": "Estado de la app",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnly": true }
        }],
        "largeProjectField": "x".repeat(MAX_CONTEXT_CHARS + 1_000)
    });
    let packed = assistant_context(Some(&context));
    assert!(packed.contains("CATALOGO_MCP_JSON"));
    assert!(packed.contains("app_status"));
    assert!(packed.contains("inputSchema"));
    assert!(packed.contains("CEREBRO DE EDICION"));
    assert!(packed.contains("CONTEXTO DEL PROYECTO"));
    assert!(!packed.contains("mcpTools\\\":"));
    assert!(!packed.contains("CATALOGO PARCIAL"));
}

#[test]
fn assistant_context_degrades_the_catalog_by_tool_instead_of_dropping_it() {
    let small_tool = |name: &str| {
        json!({
            "name": name,
            "description": "x".repeat(1_000),
            "inputSchema": { "type": "object", "properties": {} }
        })
    };
    let context = json!({
        "mcpTools": [
            small_tool("app_status"),
            small_tool("media_probe"),
            {
                "name": "oversized",
                "schema": "y".repeat(MAX_ASSISTANT_MCP_CATALOG_BYTES)
            }
        ]
    });
    let packed = assistant_context(Some(&context));
    // Las herramientas chicas se conservan; sólo la gigante queda afuera y
    // el modelo recibe un aviso explícito de que el catálogo es parcial.
    assert!(packed.contains("CATALOGO_MCP_JSON"), "{packed}");
    assert!(packed.contains("app_status"));
    assert!(packed.contains("media_probe"));
    assert!(!packed.contains("oversized"));
    assert!(packed.contains("CATALOGO PARCIAL"), "{packed}");
    assert!(packed.contains("2 de 3"), "{packed}");
}

#[test]
fn assistant_context_warns_when_no_tool_fits_the_budget() {
    let context = json!({
        "mcpTools": [{
            "name": "oversized",
            "schema": "x".repeat(MAX_ASSISTANT_MCP_CATALOG_BYTES)
        }]
    });
    let packed = assistant_context(Some(&context));
    assert!(
        !packed.contains("(nombres, descripciones y JSON Schema)"),
        "{packed}"
    );
    assert!(packed.contains("ninguna de las 1 herramientas"), "{packed}");
}

#[test]
fn mcp_action_requires_a_bounded_tool_name_and_object_arguments() {
    assert_eq!(
        clean_action(Some(&json!({
            "kind": "mcp_call",
            "tool": "app_status",
            "arguments": {}
        }))),
        Some(json!({
            "kind": "mcp_call",
            "tool": "app_status",
            "arguments": {}
        }))
    );
    assert!(clean_action(Some(&json!({
        "kind": "mcp_call",
        "tool": "",
        "arguments": {}
    })))
    .is_none());
    assert!(clean_action(Some(&json!({
        "kind": "mcp_call",
        "tool": "app_status",
        "arguments": []
    })))
    .is_none());

    let oversized = json!({
        "kind": "mcp_call",
        "tool": "settings_set",
        "arguments": { "payload": "x".repeat(MAX_ASSISTANT_MCP_ARGS_BYTES) }
    });
    assert!(clean_action(Some(&oversized)).is_none());

    let many_fields = (0..=MAX_ASSISTANT_MCP_ARG_FIELDS)
        .map(|index| (format!("key_{index}"), json!(index)))
        .collect::<serde_json::Map<String, Value>>();
    assert!(clean_action(Some(&json!({
        "kind": "mcp_call",
        "tool": "settings_set",
        "arguments": Value::Object(many_fields)
    })))
    .is_none());
}

#[test]
fn mock_mode_returns_a_navigation_action() {
    let reply = mock_reply(
        &[AssistantMessage {
            role: "user".to_owned(),
            content: "abrí el editor".to_owned(),
        }],
        "mock",
    );
    assert!(reply.simulated);
    assert_eq!(reply.action.unwrap()["view"], "editor");
}

#[test]
fn rejects_empty_conversations() {
    let error = clean_messages(&[]).expect_err("debe rechazar");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);
}

/// Ronda real contra el proveedor local configurado (por defecto Ollama
/// qwen2.5:3b en 127.0.0.1:11435). Requiere `EDITOR_IA_RUN_RENDER_TESTS=1`
/// y el servicio encendido; mide latencia y verifica que la respuesta
/// llegue por el mismo camino que usa el comando.
#[test]
#[ignore = "llamada real al proveedor; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
fn live_local_provider_round_trip_answers_the_assistant() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la llamada real");
        return;
    }
    let base_url = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:11435/v1".to_owned());
    let model =
        std::env::var("EDITOR_IA_ASSISTANT_MODEL").unwrap_or_else(|_| "qwen2.5:3b".to_owned());
    let messages = vec![AssistantMessage {
        role: "user".to_owned(),
        content: "En una frase: ¿qué podés hacer por mí en la app?".to_owned(),
    }];

    let started = std::time::Instant::now();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime de tokio");
    let body_messages = assistant_body_messages("{}", &messages);
    let (reply, actions) = runtime
        .block_on(crate::application::assistant::assistant_provider_call(
            &crate::infrastructure::ai::ReqwestProviderChat,
            &base_url,
            &model,
            body_messages,
            None,
        ))
        .expect("el proveedor local debe responder");
    let elapsed = started.elapsed();

    eprintln!("ronda real {model} en {elapsed:.1?}: “{reply}” (actions={actions:?})");
    assert!(!reply.trim().is_empty(), "la respuesta quedó vacía");
    assert_ne!(
        reply, "Listo. ¿Qué querés hacer ahora?",
        "la respuesta cayó al texto de fallback: el proveedor no contestó contenido"
    );
}

// --- Streaming SSE -----------------------------------------------------

#[test]
fn stream_request_body_asks_for_sse_and_json_mode() {
    let messages = vec![json!({ "role": "user", "content": "hola" })];
    let with_json = stream_request_body("modelo", &messages, true);
    assert_eq!(with_json["stream"], true);
    assert_eq!(with_json["response_format"]["type"], "json_object");
    assert_eq!(with_json["messages"][0]["content"], "hola");

    let plain = stream_request_body("modelo", &messages, false);
    assert!(plain.get("response_format").is_none());
    assert_eq!(plain["stream"], true);
}

#[test]
fn retry_without_json_mode_only_for_parameter_rejections() {
    for status in [400, 415, 422] {
        assert!(retry_without_json_mode(status), "{status}");
    }
    for status in [401, 403, 404, 429, 500, 503] {
        assert!(!retry_without_json_mode(status), "{status}");
    }
}

#[test]
fn sse_parser_handles_incremental_chunks_and_done() {
    let sse = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hola\"}}]}\n\n",
        ": keep-alive\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\" \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"mundo\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let mut parser = SseStreamParser::default();
    let mut deltas = Vec::new();
    // Un byte por vez: el caso más hostil de chunks partidos.
    for byte in sse.as_bytes() {
        deltas.extend(parser.push_chunk(std::slice::from_ref(byte)));
    }
    assert_eq!(deltas, vec!["Hola", " ", "mundo"]);
    assert!(parser.done);
    assert!(parser.finish().is_empty());
}

#[test]
fn sse_parser_ignores_empty_deltas_comments_and_crlf() {
    let sse = concat!(
        ": ping\r\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\r\n",
        "data: {\"choices\":[{\"delta\":{}}]}\r\n",
        "event: message\r\n",
        "data: {\"choices\":[{\"message\":{\"content\":\"final\"}}]}\r\n"
    );
    let mut parser = SseStreamParser::default();
    let deltas = parser.push_chunk(sse.as_bytes());
    assert_eq!(deltas, vec!["final"]);
    assert!(!parser.done);
}

#[test]
fn sse_parser_finish_returns_the_last_line_without_newline() {
    let mut parser = SseStreamParser::default();
    assert!(parser
        .push_chunk(b"data: {\"choices\":[{\"delta\":{\"content\":\"parcial\"}}]}")
        .is_empty());
    assert_eq!(parser.finish(), vec!["parcial"]);
}

#[test]
fn consume_sse_stream_accumulates_and_observes_cancellation() {
    let sse = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"uno\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"dos\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let cancel = AtomicBool::new(false);
    let mut reader = std::io::Cursor::new(sse.as_bytes().to_vec());
    let mut seen: Vec<String> = Vec::new();
    let (content, cancelled) =
        consume_sse_stream(&mut reader, &cancel, |delta| seen.push(delta.to_owned()))
            .expect("stream válido");
    assert_eq!(content, "unodos");
    assert_eq!(seen, vec!["uno", "dos"]);
    assert!(!cancelled);

    // Cancelado de antemano: no consume nada y avisa que fue cancelación.
    let cancel = AtomicBool::new(true);
    let mut reader = std::io::Cursor::new(sse.as_bytes().to_vec());
    let (content, cancelled) =
        consume_sse_stream(&mut reader, &cancel, |_| {}).expect("cancelación");
    assert!(content.is_empty());
    assert!(cancelled);
}

/// Misma lógica que `commands::assistant::cancel_assistant_stream`, ejercida
/// acá contra el registro del dominio (el comando es un adaptador de una línea).
fn cancel_stream(id: &str) -> bool {
    let Some(id) = clean_stream_id(id) else {
        return false;
    };
    if let Ok(map) = active_streams().lock() {
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

#[test]
fn stream_registry_cancels_and_cleans_up() {
    let registration = StreamRegistration::new("stream-test-1");
    assert!(cancel_stream("stream-test-1"));
    assert!(registration.cancel_flag().load(Ordering::SeqCst));
    drop(registration);
    // Al terminar el trabajo el registro se limpia: cancelar ya no encuentra nada.
    assert!(!cancel_stream("stream-test-1"));
    assert!(!cancel_stream("id con espacios"));
    assert_eq!(
        clean_stream_id(" abc-123_ok:1 ").as_deref(),
        Some("abc-123_ok:1")
    );
    assert!(clean_stream_id("").is_none());
    assert!(clean_stream_id("x".repeat(MAX_STREAM_ID_CHARS + 1).as_str()).is_none());
}

#[test]
fn consumes_a_real_sse_response_from_a_local_server() {
    use std::io::{Read as _, Write as _};
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("puerto de prueba");
    let address = listener.local_addr().expect("dirección");
    let server = std::thread::spawn(move || {
        let Ok((mut socket, _)) = listener.accept() else {
            return;
        };
        // Leer hasta el final de los headers antes de responder.
        let mut received = Vec::new();
        let mut chunk = [0u8; 1024];
        while !received.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => received.extend_from_slice(&chunk[..read]),
            }
        }
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hola\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" SSE\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        let _ = socket.write_all(response.as_bytes());
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("cliente de prueba");
    let response = client
        .get(format!("http://{address}/v1/chat/completions"))
        .send()
        .expect("el servidor local responde");
    assert_eq!(response.status().as_u16(), 200);
    let mut response = response;
    let cancel = AtomicBool::new(false);
    let mut seen: Vec<String> = Vec::new();
    let (content, cancelled) =
        consume_sse_stream(&mut response, &cancel, |delta| seen.push(delta.to_owned()))
            .expect("SSE real");
    let _ = server.join();
    assert_eq!(content, "Hola SSE");
    assert_eq!(seen, vec!["Hola", " SSE"]);
    assert!(!cancelled);
}
