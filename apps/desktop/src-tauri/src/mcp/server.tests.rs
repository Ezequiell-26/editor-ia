use super::*;

#[test]
fn merge_olyvia_entry_preserves_other_servers_and_settings() {
    let mut root = json!({
        "mcpServers": {
            "otro-servidor": { "command": "npx", "args": ["-y", "algo"] }
        },
        "theme": "dark"
    });
    merge_olyvia_entry(
        &mut root,
        json!({ "type": "http", "url": "http://127.0.0.1:1" }),
    );
    assert_eq!(root["theme"], "dark");
    assert_eq!(root["mcpServers"]["otro-servidor"]["command"], "npx");
    assert_eq!(root["mcpServers"]["olyvia"]["type"], "http");
}

#[test]
fn merge_olyvia_entry_replaces_only_olyvia_and_repairs_bad_shapes() {
    let mut root = json!({
        "mcpServers": {
            "olyvia": { "type": "sse", "url": "http://viejo" },
            "otro": { "command": "x" }
        }
    });
    merge_olyvia_entry(&mut root, json!({ "type": "http", "url": "http://nuevo" }));
    assert_eq!(root["mcpServers"]["olyvia"]["url"], "http://nuevo");
    assert_eq!(root["mcpServers"]["otro"]["command"], "x");

    let mut bad = json!({ "mcpServers": "no-es-objeto", "ajuste": 1 });
    merge_olyvia_entry(&mut bad, json!({ "ok": true }));
    assert_eq!(bad["ajuste"], 1);
    assert_eq!(bad["mcpServers"]["olyvia"]["ok"], true);

    let mut scalar = json!("basura");
    merge_olyvia_entry(&mut scalar, json!({ "ok": true }));
    assert_eq!(scalar["mcpServers"]["olyvia"]["ok"], true);
}

#[test]
fn fallback_catalog_covers_the_core() {
    let list = tools();
    let names: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(names.len(), 37);
    for required in [
        "diagnostics",
        "run_command",
        "project_summary",
        "project_snapshot",
        "timeline_clips",
        "clip_update",
        "clip_move",
        "clip_split",
        "caption_add",
        "run_automation",
        "export_render",
        "navigate",
        "factory_run",
        "factory_job_status",
        "factory_job_list",
        "factory_job_cancel",
        "production_list",
        "production_status",
        "production_create",
        "production_start",
        "production_advance",
        "production_cancel",
        "production_resume",
        "production_pause",
        "studio_capabilities",
        "production_plan_from_brief",
        "production_plan_from_text",
    ] {
        assert!(names.contains(&required), "falta {required}");
    }
}

#[test]
fn read_only_batch_policy_follows_the_published_catalog() {
    let catalog = json!([
        {
            "name": "project_read",
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "project_write",
            "annotations": { "readOnlyHint": false }
        },
        {
            "name": "unknown",
            "annotations": {}
        }
    ]);
    let items = catalog.as_array().expect("catalog array");
    let names = collect_read_only_tools(items);
    assert!(names.contains("project_read"));
    assert!(!names.contains("project_write"));
    assert!(!names.contains("unknown"));
}

#[test]
fn fallback_catalog_has_risk_annotations_for_every_tool() {
    let list = tools();
    let items = list.as_array().expect("fallback catalog must be an array");
    fn schema_is_closed(schema: &Value) -> bool {
        if schema["type"].as_str() == Some("object")
            && schema["additionalProperties"] != Value::Bool(false)
        {
            return false;
        }
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            if !properties.values().all(schema_is_closed) {
                return false;
            }
        }
        if let Some(items) = schema.get("items") {
            if !schema_is_closed(items) {
                return false;
            }
        }
        true
    }

    for item in items {
        assert!(item["annotations"]["title"].is_string());
        assert!(item["annotations"]["readOnlyHint"].is_boolean());
        assert!(item["annotations"]["destructiveHint"].is_boolean());
        assert!(item["annotations"]["idempotentHint"].is_boolean());
        assert!(item["annotations"]["openWorldHint"].is_boolean());
        assert!(
            schema_is_closed(&item["inputSchema"]),
            "esquema abierto: {}",
            item["name"]
        );
    }
    let factory = items
        .iter()
        .find(|item| item["name"] == "factory_run")
        .expect("factory_run must exist");
    assert_eq!(factory["annotations"]["destructiveHint"], true);
    let diagnostic = items
        .iter()
        .find(|item| item["name"] == "diagnostics")
        .expect("diagnostics must exist");
    assert_eq!(diagnostic["annotations"]["readOnlyHint"], true);
}

/// Set read-only derivado del catálogo fallback, igual que hace el
/// dispatcher cuando la ventana no publicó su catálogo.
fn fallback_read_only() -> HashSet<String> {
    tools()
        .as_array()
        .map(|items| collect_read_only_tools(items))
        .unwrap_or_default()
}

#[test]
fn only_explicit_read_tools_are_parallelized_in_batches() {
    let read_only = fallback_read_only();
    let read = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": "project_snapshot", "arguments": {} }
    });
    let diagnostic_read = json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": { "name": "diagnostics", "arguments": {} }
    });
    let write = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": { "name": "clip_update", "arguments": { "clipId": "clip-1" } }
    });
    let unknown = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": { "name": "future_tool", "arguments": {} }
    });
    let notification = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });

    let job_read = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": { "name": "factory_job_status", "arguments": { "jobId": "job-1" } }
    });
    let job_cancel = json!({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": { "name": "factory_job_cancel", "arguments": { "jobId": "job-1" } }
    });

    assert!(is_parallel_read_request(&read_only, &read));
    assert!(is_parallel_read_request(&read_only, &diagnostic_read));
    assert!(is_parallel_read_request(&read_only, &job_read));
    assert!(is_parallel_read_request(
        &read_only,
        &json!({ "method": "ping", "id": 4 })
    ));
    assert!(is_parallel_read_request(&read_only, &notification));
    assert!(!is_parallel_read_request(&read_only, &write));
    assert!(!is_parallel_read_request(&read_only, &job_cancel));
    assert!(!is_parallel_read_request(&read_only, &unknown));
}

#[test]
fn accepts_only_json_rpc_id_scalars() {
    assert!(valid_rpc_id(&json!(null)));
    assert!(valid_rpc_id(&json!("request-1")));
    assert!(valid_rpc_id(&json!(42)));
    assert!(!valid_rpc_id(&json!(true)));
    assert!(!valid_rpc_id(&json!([])));
    assert!(!valid_rpc_id(&json!({ "nested": 1 })));
}

#[test]
fn classify_request_distinguishes_calls_notifications_and_errors() {
    // Request válido → Call con su id.
    match classify_request(&json!({
        "jsonrpc": "2.0", "id": 3, "method": "ping"
    })) {
        RpcRequest::Call(id) => assert_eq!(id, json!(3)),
        _ => panic!("debía ser Call"),
    }
    // Notificación → sin respuesta.
    assert!(matches!(
        classify_request(&json!({
            "jsonrpc": "2.0", "method": "notifications/initialized"
        })),
        RpcRequest::Notification
    ));
    // jsonrpc inválido → Reject.
    assert!(matches!(
        classify_request(&json!({ "id": 1, "method": "ping" })),
        RpcRequest::Reject(_)
    ));
    // params no-objeto → Reject.
    assert!(matches!(
        classify_request(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": []
        })),
        RpcRequest::Reject(_)
    ));
    // id booleano → Reject con id null.
    match classify_request(&json!({
        "jsonrpc": "2.0", "id": true, "method": "ping"
    })) {
        RpcRequest::Reject(response) => assert_eq!(response["id"], json!(null)),
        _ => panic!("debía ser Reject"),
    }
}

#[test]
fn reads_headers_case_insensitively() {
    let head = "POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n\r\n";
    assert_eq!(
        header_value(head, "authorization"),
        Some("Bearer abc".to_owned())
    );
}

#[test]
fn validates_http_body_headers() {
    let valid = "POST /mcp HTTP/1.1\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\n\r\n";
    assert!(is_json_content_type(valid));
    assert_eq!(request_content_length(valid), Ok(2));
    let missing = "POST /mcp HTTP/1.1\r\nContent-Type: application/json\r\n\r\n";
    assert_eq!(request_content_length(missing), Err("falta content-length"));
    let duplicate = "POST /mcp HTTP/1.1\r\nContent-Length: 2\r\ncontent-length: 2\r\n\r\n";
    assert_eq!(
        request_content_length(duplicate),
        Err("content-length duplicado")
    );
    let chunked = "POST /mcp HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";
    assert_eq!(
        request_content_length(chunked),
        Err("transfer-encoding no compatible")
    );
    let invalid = "POST /mcp HTTP/1.1\r\nContent-Length: 2x\r\n\r\n";
    assert_eq!(
        request_content_length(invalid),
        Err("content-length inválido")
    );
    let wrong_type = "POST /mcp HTTP/1.1\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n";
    assert!(!is_json_content_type(wrong_type));
}

#[test]
fn tool_result_marks_errors() {
    let value = tool_result("falló", true);
    assert_eq!(value["isError"], json!(true));
    assert_eq!(value["content"][0]["text"], json!("falló"));
}

#[test]
fn client_entries_match_each_client_shape() {
    let info = McpServerInfo {
        url: "http://127.0.0.1:31417/mcp".to_owned(),
        token: "tok".to_owned(),
    };
    let claude = client_entry("claude-desktop", &info).expect("claude entry");
    assert_eq!(claude["type"], "http");
    assert_eq!(claude["url"], info.url);
    assert_eq!(claude["headers"]["Authorization"], "Bearer tok");
    let antigravity = client_entry("antigravity", &info).expect("antigravity entry");
    assert_eq!(antigravity["serverUrl"], info.url);
    assert!(client_entry("otro", &info).is_none());
}

#[test]
fn autoconnect_entries_request_scopes_but_never_admin() {
    let info = McpServerInfo {
        url: "http://127.0.0.1:31417/mcp".to_owned(),
        token: "tok".to_owned(),
    };
    for client in ["claude-desktop", "antigravity"] {
        let entry = client_entry(client, &info).expect("entry");
        let scopes = entry["headers"]["X-Olyvia-Scopes"]
            .as_str()
            .expect("scopes header");
        assert_eq!(scopes, AUTOCONNECT_SCOPES);
        assert!(!scopes.split(',').any(|scope| scope == "admin"));
    }
}

#[test]
fn tool_scopes_classify_reads_writes_destructive_and_admin() {
    // Lectura pura.
    for name in [
        "diagnostics",
        "project_snapshot",
        "timeline_clips",
        "factory_job_status",
        "production_status",
        "quality_gate_review",
        "markers_list",
        "fs_read",
    ] {
        assert_eq!(tool_required_scope(name), "read", "{name}");
    }
    // Escritura acotada.
    for name in [
        "clip_update",
        "clip_move",
        "clip_split",
        "clip_add",
        "caption_add",
        "track_add",
        "project_save",
        "navigate",
        "batch_effects_apply",
        "timeline_align_clips",
    ] {
        assert_eq!(tool_required_scope(name), "write", "{name}");
    }
    // Destructivas / con costo.
    for name in [
        "clip_delete",
        "caption_delete",
        "track_delete",
        "project_close",
        "export_render",
        "factory_run",
        "factory_job_cancel",
        "production_cancel",
        "production_start",
        "run_automation",
        "diarize",
        "screen_record",
        "fs_delete_x", // nombre parecido pero no listado → desconocida
    ] {
        assert_eq!(tool_required_scope(name), "destructive", "{name}");
    }
    // Admin.
    for name in [
        "run_command",
        "flow_embed_eval",
        "fs_write",
        "fs_delete",
        "fs_mkdir",
        "fs_move",
        "settings_set",
        "settings_set_tools",
    ] {
        assert_eq!(tool_required_scope(name), "admin", "{name}");
    }
    // Desconocida → destructive (deny-by-default).
    assert_eq!(tool_required_scope("future_unknown_tool"), "destructive");
}

#[test]
fn scopes_header_parses_csv_and_defaults_to_read_write() {
    let granted = request_scopes(Some("read, write ,DESTRUCTIVE, bogus"));
    assert!(granted.contains("read"));
    assert!(granted.contains("write"));
    assert!(granted.contains("destructive"));
    assert!(!granted.contains("bogus"));
    assert!(!granted.contains("admin"));

    let defaulted = request_scopes(None);
    assert!(defaulted.contains("read"));
    assert!(defaulted.contains("write"));
    assert!(!defaulted.contains("destructive"));
    assert!(!defaulted.contains("admin"));

    // Header presente pero sin scopes válidos → default.
    let empty = request_scopes(Some("bogus,,"));
    assert!(empty.contains("read"));
    assert!(!empty.contains("admin"));
}

#[test]
fn scope_satisfaction_uses_rank_not_exact_membership() {
    let admin = scopes_from_header("admin");
    assert!(scopes_satisfy(&admin, "read"));
    assert!(scopes_satisfy(&admin, "write"));
    assert!(scopes_satisfy(&admin, "destructive"));
    assert!(scopes_satisfy(&admin, "admin"));

    let destructive = scopes_from_header("destructive");
    assert!(scopes_satisfy(&destructive, "read"));
    assert!(scopes_satisfy(&destructive, "write"));
    assert!(scopes_satisfy(&destructive, "destructive"));
    assert!(!scopes_satisfy(&destructive, "admin"));

    let write = scopes_from_header("write");
    assert!(scopes_satisfy(&write, "read"));
    assert!(scopes_satisfy(&write, "write"));
    assert!(!scopes_satisfy(&write, "destructive"));
    assert!(!scopes_satisfy(&write, "admin"));

    let none = HashSet::new();
    assert!(!scopes_satisfy(&none, "read"));
}

#[test]
fn audit_args_redact_sensitive_keys_and_truncate_strings() {
    let args = json!({
        "command": "export_render",
        "apiKey": "sk-supersecreta-123",
        "nested": { "password": "hunter2", "note": "ok" },
        "long": "x".repeat(1000),
        "count": 3
    });
    let clean = sanitize_audit_args(&args);
    assert_eq!(clean["apiKey"], json!("[redacted]"));
    assert_eq!(clean["nested"]["password"], json!("[redacted]"));
    assert_eq!(clean["nested"]["note"], json!("ok"));
    assert_eq!(clean["count"], json!(3));
    let long = clean["long"].as_str().expect("long string");
    assert!(long.chars().count() <= 240);
    assert!(long.ends_with('…'));
    // El secreto no aparece en ninguna parte del JSON serializado.
    let serialized = serde_json::to_string(&clean).unwrap();
    assert!(!serialized.contains("sk-supersecreta-123"));
    assert!(!serialized.contains("hunter2"));
}

#[test]
fn audit_args_drop_oversized_payloads() {
    // Un solo string se trunca por campo; para superar el tope hacen
    // falta muchos campos (cada uno queda en ~240 chars).
    let mut map = serde_json::Map::new();
    for index in 0..80 {
        map.insert(format!("field{index}"), json!("y".repeat(300)));
    }
    let clean = sanitize_audit_args(&Value::Object(map));
    assert!(clean.is_string());
}

#[test]
fn audit_text_redacts_bearer_and_labeled_secrets() {
    let dirty = "falló: Authorization: Bearer abc.def.ghi y api_key=sk-live-999 en el log";
    let clean = sanitize_audit_text(dirty);
    assert!(!clean.contains("abc.def.ghi"));
    assert!(!clean.contains("sk-live-999"));
    // El nombre de la clave se conserva para diagnóstico.
    assert!(clean.contains("api_key"));
    assert!(clean.contains("Authorization"));
}

#[test]
fn redact_sensitive_text_masks_known_literal_secrets() {
    let secrets = vec!["MIIVALORSECRETO999".to_owned()];
    let text = "stderr: token=MIIVALORSECRETO999 retrying";
    let clean = redact_sensitive_text(text, &secrets);
    assert!(!clean.contains("MIIVALORSECRETO999"));
    // Secretos cortos no se tapan (evita falsos positivos masivos).
    let short = vec!["abc".to_owned()];
    assert_eq!(redact_sensitive_text("abc abc", &short), "abc abc");
}
