use super::*;

fn base(command: &str) -> McpServerInput {
    McpServerInput {
        id: None,
        name: "Fixture".to_owned(),
        command: command.to_owned(),
        args: Vec::new(),
        env: Vec::new(),
        working_dir: None,
        enabled: true,
    }
}

#[test]
fn validates_bounded_config() {
    assert!(validate(&base("node")).is_ok());
    assert!(validate(&McpServerInput {
        name: String::new(),
        ..base("node")
    })
    .is_err());
    assert!(validate(&McpServerInput {
        args: vec!["a\nb".to_owned()],
        ..base("node")
    })
    .is_err());
    assert!(validate(&McpServerInput {
        env: vec![McpEnvInput {
            key: "BAD-KEY".to_owned(),
            value: Some("x".to_owned()),
        }],
        ..base("node")
    })
    .is_err());
    assert!(valid_env_key("GITHUB_TOKEN"));
    assert!(!valid_env_key("1TOKEN"));
}

#[test]
fn working_dir_must_exist() {
    assert!(validate_working_dir(None).is_ok());
    assert!(validate_working_dir(Some("")).is_ok());
    assert!(validate_working_dir(Some("Z:\\no-existe-editoria")).is_err());
}

#[cfg(windows)]
#[test]
fn shell_launch_rejects_cmd_metachars() {
    // npx/npm van por cmd /C: un `&` en args ejecutaría otro comando.
    assert!(check_shell_launch(
        "npx",
        &["pkg".to_owned(), "&".to_owned(), "calc".to_owned()]
    )
    .is_err());
    assert!(check_shell_launch("npm", &["run".to_owned(), "x|whoami".to_owned()]).is_err());
    assert!(check_shell_launch("npx", &["-y".to_owned(), "@playwright/mcp".to_owned()]).is_ok());
    // Lanzadores directos (node, .exe) no pasan por cmd: sin restricción.
    assert!(check_shell_launch("node", &["server.js".to_owned(), "a&b".to_owned()]).is_ok());
    assert!(needs_cmd_shell("npx"));
    assert!(needs_cmd_shell("C:\\tools\\server.cmd"));
    assert!(!needs_cmd_shell("node"));
}

#[test]
fn parse_tools_bounds_and_defaults() {
    let result = serde_json::json!({
        "tools": [
            { "name": "echo", "description": "devuelve texto", "inputSchema": { "type": "object" } },
            { "name": "  " },
            { "description": "sin nombre" }
        ]
    });
    let tools = parse_tools(&result);
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "echo");
    assert_eq!(tools[0].description.as_deref(), Some("devuelve texto"));
    assert!(parse_tools(&serde_json::json!({})).is_empty());
}

#[test]
fn jsonrpc_builders_match_the_stdio_contract() {
    let init = initialize_request();
    assert_eq!(init["method"], "initialize");
    assert_eq!(init["params"]["clientInfo"]["name"], "Editor IA");

    let note = initialized_notification();
    assert_eq!(note["method"], "notifications/initialized");
    assert!(note.get("id").is_none());

    let list = tools_list_request(7, Some("cursor-1"));
    assert_eq!(list["id"], 7);
    assert_eq!(list["params"]["cursor"], "cursor-1");
    let list = tools_list_request(8, None);
    assert!(list["params"].get("cursor").is_none());

    let call = tools_call_request(9, "echo", &serde_json::json!({ "text": "hola" }));
    assert_eq!(call["method"], "tools/call");
    assert_eq!(call["params"]["name"], "echo");
    assert_eq!(call["params"]["arguments"]["text"], "hola");
}

#[test]
fn handshake_fields_reads_server_info() {
    let result = serde_json::json!({
        "protocolVersion": "2025-06-18",
        "serverInfo": { "name": "fixture", "version": "1.2.3" }
    });
    let (protocol, name, version) = handshake_fields(&result);
    assert_eq!(protocol, "2025-06-18");
    assert_eq!(name, "fixture");
    assert_eq!(version, "1.2.3");
    let (protocol, name, _) = handshake_fields(&serde_json::json!({}));
    assert_eq!(protocol, "desconocida");
    assert_eq!(name, "servidor MCP");
}
