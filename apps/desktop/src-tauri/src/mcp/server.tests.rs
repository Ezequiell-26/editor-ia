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
