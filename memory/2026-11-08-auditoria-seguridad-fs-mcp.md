# Auditoría de seguridad — fs_* traversal y MCP cmd injection (2026-11-08)

Dos vulnerabilidades reales encontradas y corregidas en pasadas del loop:

## 1. Path traversal en comandos fs_* (`7e0ff5d`)

`inside_system_dir`/`protected_delete_target` comparaban el string literal
de la ruta. `C:\foo\..\Windows\System32\x` no matcheaba el prefijo
`c:\windows\` pero el SO sí resolvía `..` → escritura/borrado dentro de
carpetas de sistema.

Fix: `normalized_components()` resuelve `.`/`..` léxicamente antes de los
chequeos. `fs_move` además ahora aplica `protected_delete_target` al origen.
Residual: junctions/symlinks no se canonicalizan (riesgo bajo en Windows
sin admin).

Tests: `normalized_components_resolves_dotdot`,
`system_dir_check_blocks_dotdot_traversal` → 13/13 files verde.

## 2. Inyección cmd.exe en servidores MCP (`a875a6f`)

`build_command` lanzaba npx/npm/.cmd/.bat vía `cmd /C` sin sanitizar:
un arg con `&`, `|`, `<>`, `^`, `%`, `!`, comillas o paréntesis podía
encadenar comandos arbitrarios al spawn.

Fix: `build_command` devuelve `Result`; bloquea metacaracteres cmd solo
en el camino con shell. Binarios directos no se restringen.

Test: `build_command_rejects_cmd_metachars_for_shell_launchers` → 18/18 mcp.

## Auditado sin hallazgos

- `downloader.rs`: `validate_url` exige http/https, proxy limitado a
  http/https/socks4/socks5, cookies file validado. yt-dlp/ffmpeg reciben
  args como argv separados (sin shell).
- `automation.rs`: watch-folder solo lee/escanea, no ejecuta procesos.
- `system.rs`: `find_executable` busca en PATH/ProgramData/WinGet links,
  sin ejecución de strings arbitrarios.

## Pendiente de auditoría

- Junctions/symlinks en fs_* (canonicalización completa).
- Secretos en mensajes de error/logs (stderr tails de MCP, ffmpeg).
- `flow_browser.rs`/`browser_instances.rs`: flags de Chrome con input
  de usuario (window_title → filtro ffmpeg).
