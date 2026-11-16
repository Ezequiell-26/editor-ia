# Runbooks — Olyvia / Editor IA

Runbooks mínimos para operación y recuperación. Para el proceso de release completo ver `docs/RELEASE.md`.

---

## 1. Release

Ver **`docs/RELEASE.md`** (proceso canónico de versionado, build del instalador y publicación).

Checklist previo (resumen; el detalle está en RELEASE.md):

1. Gates en verde desde checkout limpio: `npm run verify`, typecheck, `cargo test --lib`, build del instalador, install smoke.
2. Licencias: `THIRD-PARTY-NOTICES.md` al día con lo que realmente se empaqueta (FFmpeg incluido — ver deuda GPL en `PDF-100-TRACKER.md` F10).
3. No subir versión ni publicar sin autorización explícita del usuario.

---

## 2. Recuperar un proyecto corrupto

Olyvia guarda **snapshots automáticos** en `<raíz-del-proyecto>/.olyvia-history/<timestamp>-<motivo>.editoria.json`
(implementación: `apps/desktop/src-tauri/src/infrastructure/projects_history.rs`, `HISTORY_DIR = ".olyvia-history"`).

Pasos:

1. Cerrar el proyecto en la app (no seguir editando sobre el archivo roto).
2. Listar snapshots: `ls <proyecto>/.olyvia-history/` ordenado por fecha; cada entrada es un `.editoria.json` completo.
3. Verificar integridad del candidato: abrirlo con el validador del proyecto (`project-schema`) o intentar `open` en la app sobre una **copia**.
4. Restaurar: copiar el snapshot elegido sobre el `.editoria.json` dañado (mantener backup del dañado con otro nombre, p.ej. `.editoria.json.broken`).
5. Reabrir el proyecto y verificar timeline/assets; si faltan archivos referenciados usar la herramienta de relink (`RelinkAssets` / recovery de assets).

> Si `.olyvia-history/` no existe o está vacío, el proyecto nunca se guardó desde esta versión o el historial está deshabilitado; la recuperación queda limitada a backups externos.

---

## 3. Render queue corrupta

La cola de render persiste en el estado del proyecto/dispositivo (`render/queue.rs`, scope por `projectId`/`projectName` — fix `cf4ba59`).

Síntomas: la app no lista exports, jobs fantasma, o la cola no avanza.

Pasos:

1. Cancelar jobs activos desde la UI de exportación si responde.
2. Localizar el archivo de cola (busque `render-queue`/`render_queue` en el directorio de datos de la app o dentro del proyecto).
3. Con la app cerrada, mover el archivo de cola a un backup (`*.bak`) — la app lo recrea vacío al arrancar.
4. Reabrir y re-encolar los exports necesarios.
5. Si el archivo está dentro del `.editoria.json` del proyecto y el proyecto abre bien, preferir quitar la sección de cola editando con backup previo en vez de tocar el documento a mano.

---

## 4. MCP server colgado (127.0.0.1:31417)

El servidor MCP embebido escucha en `127.0.0.1:31417` (`src/mcp/server.rs`, `MCP_PORT = 31417`).

Síntomas: clientes IA (Claude Desktop, Antigravity, etc.) no conectan; `mcp_server_autoconnect` falla con "el puerto MCP 31417 esta ocupado" (`infrastructure/mcp_server.rs:457`).

Pasos:

1. Verificar qué proceso ocupa el puerto:
   `netstat -ano | findstr :31417` → anotar el PID.
2. Si es una instancia previa de Olyvia que no cerró limpio: cerrarla o matar ese PID (`taskkill /PID <pid> /F`) — sólo si confirmás que es la app.
3. Si es otro proceso ajeno, cambiar la configuración del cliente MCP para apuntar a otro puerto o liberar ese puerto.
4. En la app: Ajustes/Herramientas → reconectar/autoconectar el servidor MCP (`mcp_server_autoconnect` re-escribe `mcpServers.olyvia` sin tocar otras entradas).
5. Verificación: el cliente MCP debe listar las ~108 tools del catálogo (`mcp-catalog.ts`).

> Deuda conocida (F6): el servidor MCP no tiene comando `stop` ni scopes de token; si el cuelgue es recurrente, reiniciar la app completa es el workaround actual.

---

## 5. Rollback de versión

1. **Código:** no hay tags de release garantizados; usar `git log` para ubicar el último commit estable conocido y crear una rama de rollback desde ahí. **No hacer `reset --hard` ni descartar WIP sin autorización.**
2. **App instalada:** desinstalar la versión actual e instalar el instalador anterior (los rebuilds del instalador quedan documentados en commits `docs(deliver): rebuild N`).
3. **Datos de usuario:** los proyectos `.editoria.json`, snapshots `.olyvia-history/` y configs (`obs-scenes.json`, `mcpServers`, keyring) son compatibles hacia atrás por diseño del schema versionado; un rollback de app no debería corromperlos, pero hacer backup del directorio de proyectos antes de cambiar de versión mayor.
4. **Verificación post-rollback:** abrir un proyecto real, preview un clip, lanzar un render corto y comprobar que el MCP responde.

---

## Referencias

- `docs/RELEASE.md` — proceso de release.
- `docs/architecture/PDF-100-TRACKER.md` — estado por fase y deudas conocidas.
- `docs/architecture/HANDOFF.md` — scorecard de release-readiness.
- `docs/architecture/RECONCILIATION-2026-11-11.md` — estado de sincronización con `main`.
