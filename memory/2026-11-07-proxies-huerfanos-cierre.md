# 2026-11-07 — Limpieza automática de proxies huérfanos al cerrar proyecto

Pasada del loop de mejora (Devin CLI). Ítem de `docs/FOLLOW-UPS.md` §6.1.

## Cambio

- `apps/desktop/src-tauri/src/commands/proxies.rs`:
  - `proxy_asset_id(name)`: parsea el assetId de
    `proxy-<assetId>-<quality>-<mtime>-<bytes>.mp4` (rsplitn(4) porque el
    assetId puede tener guiones, p.ej. UUID).
  - `cleanup_orphan_proxies(root, project)`: borra `proxy-*.mp4` cuyo asset
    no existe como `kind:"video"` en el proyecto. Conservador: no toca
    proxies de assets presentes aunque la huella esté vieja.
  - `cleanup_session_orphans(state)`: wrapper best-effort sobre la sesión
  activa; nunca devuelve error.
- `apps/desktop/src-tauri/src/commands/projects.rs`: `close_project` y
  `adopt` (sólo si cambia la ruta) invocan la limpieza antes de
  `set_session`. Son los únicos dos puntos de cambio de sesión.

## Verificación

- `cargo test -p editor-ia-desktop --lib proxies` → 6/6 (3 nuevos).
- `cargo test --lib commands::projects` → 7/7.
- `rustfmt --check` limpio en los dos archivos.
- Sin cambios TypeScript; no se corrió vitest.

## Notas

- La referencia es el documento en disco: assets borrados en memoria sin
  guardar conservan su proxy hasta el próximo cierre post-guardado.
- `cleanupProxies` del servicio sigue sin UI propia; la limpieza nueva es
  automática y no lo reemplaza (sigue disponible por IPC/MCP si hiciera
  falta).
