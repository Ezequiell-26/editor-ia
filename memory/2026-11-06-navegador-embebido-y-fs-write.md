# 2026-11-06 — Navegador embebido multi-web + escritura total de la IA en disco

## Qué se hizo (commit `e66e3d4`, pusheado a `origin/main`)

### Navegador dentro de la app (sin Chrome externo)
- `commands/flow_embed.rs` (nuevo): ventanas Tauri con WebView2 por **slot con
  nombre** (`web-<slot>`): `flow`, `canva`, etc. Cada sesión tiene su propio
  `data_directory` (`%LOCALAPPDATA%\com.editoria.desktop\web-sessions\<slot>`)
  y `--remote-debugging-port` derivado del nombre (Flow = 19223).
- **Bug real encontrado y resuelto**: WebView2 exige que todos los controles
  que comparten user-data-folder usen los MISMOS `AdditionalBrowserArguments`.
  La ventana principal usa `--in-process-gpu` → `HRESULT 0x8007139F`
  ("group or resource not in correct state") al crear la segunda webview.
  Fix: `.data_directory()` propio por sesión (aislamiento total entre webs,
  ideal multi-cuenta). Referencia: tauri-apps/tauri#11144, WebView2Feedback#257.
- Comandos: `web_session_open/close/nav/eval` + `web_sessions_status`;
  `flow_embed_*` quedan como alias del slot `flow`.
- Las ventanas sólo se crean en el hilo principal: el hook de test
  `EDITORIA_OPEN_EMBED=1` usa `run_on_main_thread`.
- **Verificado en vivo**: CDP `http://127.0.0.1:19223/json/version` responde
  con Edge/156 y target `https://example.com` cargada.

### Chrome dedicado por CDP (fallback)
- `commands/flow_browser.rs`: Chrome/Edge real del equipo con perfil propio
  `%LOCALAPPDATA%\Olyvia\flow-browser-profile` + CDP en puerto libre.
  Verificado antes con Chrome 156 real.

### IA con escritura total en disco (MCP)
- `commands/files.rs`: `fs_write` (texto ≤10 MiB, crea padres), `fs_mkdir`,
  `fs_delete` (recursive explícito, rutas protegidas: raíz unidad, Windows,
  Program Files), `fs_move` (no sobrescribe).
- Junto a `fs_list`/`fs_read` ya existentes → la IA crea/edita/borra/mueve
  cualquier archivo de texto de la PC.

### MCP / UI
- Tools nuevas: `web_sessions_status`, `flow_embed_*` con `slot`,
  `fs_write/fs_mkdir/fs_delete/fs_move`.
- `McpView`: tarjeta "Navegador para Flow" (embebido primario, Chrome CDP
  como fallback), preset "Navegador IA (Playwright)" → `@playwright/mcp@0.0.84`
  con `--cdp-endpoint http://127.0.0.1:19223`.

## Verificación
- `cargo check` 0 errores · `cargo test commands::files` 8/8 · `flow_embed` 3/3
- `tsc` 0 · `vitest` mcp-tools+McpView 34/34
- Release build + instalado en `%LOCALAPPDATA%\Olyvia\` · CDP real verificado

## Pendiente (próximas iteraciones)
- Login de Google dentro de WebView2: incógnita hasta probarlo con cuenta real
  (si Google lo bloquea → usar `flow_browser_*` Chrome dedicado).
- Pipeline guion→video de un clic (orquestador grande, sin empezar).
- Auditoría de rendimiento con carga real (app cerrada durante la medición;
  render ya tiene CRF/presets/NVENC maduros, descargas tienen paralelismo
  configurable — no se encontraron quick-wins sin profiling).
