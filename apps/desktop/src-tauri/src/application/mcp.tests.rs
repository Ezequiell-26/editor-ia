use super::*;
use crate::infrastructure::mcp::StdioMcpTransportFactory;
use serde_json::json;
use std::path::Path;
use std::process::Command;

fn node_available() -> bool {
    Command::new("node").arg("--version").output().is_ok()
}

fn server(id: &str, command: &str, args: Vec<String>, dir: Option<String>) -> McpServerConfig {
    McpServerConfig {
        id: id.to_owned(),
        name: id.to_owned(),
        command: command.to_owned(),
        args,
        env_keys: Vec::new(),
        working_dir: dir,
        enabled: true,
    }
}

fn write_fixture(dir: &Path, name: &str, body: &str) -> String {
    let script = dir.join(name);
    std::fs::write(&script, body).expect("script");
    script.to_string_lossy().into_owned()
}

const ECHO_SERVER: &str = r#"
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-mcp', version: '1.0.0' }
    }});
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{
      name: 'echo',
      description: 'Devuelve el texto recibido',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }] }});
  } else if (msg.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      content: [{ type: 'text', text: msg.params?.arguments?.text ?? '' }],
      isError: false
    }});
  }
});
"#;

const COUNTING_SERVER: &str = r#"
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let calls = 0;
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'counter-mcp', version: '1.0.0' }
    }});
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{
      name: 'count',
      description: 'Incrementa un contador en memoria',
      inputSchema: { type: 'object', properties: {} }
    }] }});
  } else if (msg.method === 'tools/call') {
    calls += 1;
    send({ jsonrpc: '2.0', id: msg.id, result: {
      content: [{ type: 'text', text: String(calls) }],
      isError: false
    }});
  }
});
"#;

#[test]
fn live_stdio_probe_and_tool_call() {
    if !node_available() {
        eprintln!("node no está disponible; se omite la prueba MCP en vivo");
        return;
    }
    let dir = std::env::temp_dir().join(format!("editoria-mcp-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let script = write_fixture(&dir, "fixture.mjs", ECHO_SERVER);
    let server = server("fixture", "node", vec![script], None);
    let env = BTreeMap::new();
    let factory = StdioMcpTransportFactory;
    let registry = SessionRegistry::new();

    let probe = probe_config(&factory, &server, &env).expect("probe");
    assert_eq!(probe.server_name, "fixture-mcp");
    assert_eq!(probe.tools.len(), 1);
    assert_eq!(probe.tools[0].name, "echo");

    let call = call_config(
        &registry,
        &factory,
        &server,
        &env,
        "echo",
        json!({ "text": "hola MCP" }),
    )
    .expect("call");
    assert_eq!(call.result["content"][0]["text"], "hola MCP");
    assert!(!call.is_error);

    assert!(registry.close("fixture"));
    assert!(!registry.close("fixture"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// El estado del servidor sobrevive entre llamadas: es lo que hace posible
/// navegar, leer y hacer clic sobre la misma página.
#[test]
fn live_session_keeps_state_between_calls() {
    if !node_available() {
        eprintln!("node no está disponible; se omite la prueba de sesión MCP");
        return;
    }
    let dir = std::env::temp_dir().join(format!("editoria-mcp-session-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let script = write_fixture(&dir, "counter.mjs", COUNTING_SERVER);
    let server = server("counter", "node", vec![script], None);
    let env = BTreeMap::new();
    let factory = StdioMcpTransportFactory;
    let registry = SessionRegistry::new();

    let first = call_config(&registry, &factory, &server, &env, "count", json!({}))
        .expect("primera llamada");
    assert_eq!(first.result["content"][0]["text"], "1");
    let second = call_config(&registry, &factory, &server, &env, "count", json!({}))
        .expect("segunda llamada");
    assert_eq!(second.result["content"][0]["text"], "2");

    let infos = registry.infos();
    let info = infos
        .iter()
        .find(|item| item.server_id == "counter")
        .expect("la sesión figura en el estado");
    assert_eq!(info.calls, 2);
    assert!(info.pid > 0);

    assert!(registry.close("counter"));
    assert!(registry
        .infos()
        .iter()
        .all(|item| item.server_id != "counter"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// Un servidor que muere sin responder deja su `stderr` en el mensaje: sin
/// eso el diagnóstico es "no respondió a tiempo" y no hay por dónde seguir.
#[test]
fn live_probe_reports_the_stderr_tail() {
    if !node_available() {
        eprintln!("node no está disponible; se omite la prueba de stderr MCP");
        return;
    }
    let dir = std::env::temp_dir().join(format!("editoria-mcp-stderr-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let script = write_fixture(
        &dir,
        "boom.mjs",
        "console.error('boom: falta el registro de navegadores');\nprocess.exit(3);\n",
    );
    let server = server("boom", "node", vec![script], None);
    let factory = StdioMcpTransportFactory;
    let failure = probe_config(&factory, &server, &BTreeMap::new()).expect_err("debe fallar");
    assert!(
        failure.message.contains("terminó sin responder")
            || failure
                .message
                .contains("cerró la entrada antes de responder"),
        "mensaje: {}",
        failure.message
    );
    assert!(
        failure.message.contains("boom"),
        "mensaje: {}",
        failure.message
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Prueba real contra `@playwright/mcp`: navega y después lee la misma
/// página en una segunda llamada. Si cada llamada arrancara un proceso
/// nuevo, la segunda vería `about:blank`.
///
/// Se habilita con `EDITOR_IA_MCP_PLAYWRIGHT_CLI=<ruta a cli.js>` porque
/// necesita red y un Chrome instalado.
#[test]
fn live_playwright_mcp_keeps_the_page_between_calls() {
    let Ok(cli) = std::env::var("EDITOR_IA_MCP_PLAYWRIGHT_CLI") else {
        eprintln!("sin EDITOR_IA_MCP_PLAYWRIGHT_CLI; se omite la prueba con Playwright MCP");
        return;
    };
    if !Path::new(&cli).is_file() {
        eprintln!("el cli indicado no existe; se omite la prueba con Playwright MCP");
        return;
    }
    let chrome = std::env::var("ProgramFiles")
        .map(|base| format!("{base}\\Google\\Chrome\\Application\\chrome.exe"))
        .ok()
        .filter(|path| Path::new(path).is_file());
    let Some(chrome) = chrome else {
        eprintln!("Chrome no está instalado; se omite la prueba con Playwright MCP");
        return;
    };
    let workdir = std::env::temp_dir().join(format!("editoria-mcp-live-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&workdir).expect("carpeta temporal");
    let server = server(
        "playwright-live",
        "node",
        vec![
            cli,
            "--headless".to_owned(),
            "--isolated".to_owned(),
            "--browser".to_owned(),
            "chrome".to_owned(),
            "--executable-path".to_owned(),
            chrome,
        ],
        Some(workdir.to_string_lossy().into_owned()),
    );
    let env = BTreeMap::new();
    let factory = StdioMcpTransportFactory;
    let registry = SessionRegistry::new();

    let probe = probe_config(&factory, &server, &env).expect("probe de Playwright MCP");
    assert!(
        probe
            .tools
            .iter()
            .any(|tool| tool.name == "browser_navigate"),
        "herramientas: {:?}",
        probe
            .tools
            .iter()
            .map(|tool| &tool.name)
            .collect::<Vec<_>>()
    );

    let nav = call_config(
        &registry,
        &factory,
        &server,
        &env,
        "browser_navigate",
        json!({ "url": "https://example.com" }),
    )
    .expect("navegación");
    assert!(!nav.is_error, "resultado: {}", nav.result);

    let snapshot = call_config(
        &registry,
        &factory,
        &server,
        &env,
        "browser_snapshot",
        json!({}),
    )
    .expect("snapshot");
    assert!(!snapshot.is_error, "resultado: {}", snapshot.result);
    let text = snapshot.result["content"][0]["text"]
        .as_str()
        .unwrap_or_default();
    assert!(
        text.contains("example.com") || text.contains("Example Domain"),
        "la segunda llamada no vio la página: {text}"
    );

    assert!(registry.close("playwright-live"));
    let _ = std::fs::remove_dir_all(&workdir);
}
