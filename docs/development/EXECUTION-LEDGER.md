# Editor IA — execution ledger

**Rama:** `feat/editor-ia-foundation`  
**Spec aprobada:** `docs/product/PRODUCT-SPEC.md`  
**Plan aprobado:** `docs/superpowers/plans/2026-10-18-editor-ia-foundation.md`

## Tareas

- [x] 1 — Workspaces npm/Rust y reglas del repositorio.
- [x] 2 — Esquema v1 del proyecto editable, tipos, fixture y pruebas.
- [x] 3 — UI de escritorio con Proyectos, Editor, Biblioteca y Configuración.
- [x] 4 — Crear/abrir/guardar desde Rust, validación, límite de tamaño, escritura temporal y prevención de sobrescritura al crear.
- [x] 5 — Protocolo de render con detección de motores y rechazo de estados de éxito falsos.
- [x] 6 — Servicio de proyectos conectado a diálogos nativos y flujo de guardado con pruebas.
- [x] 7 — CI y empaquetado de Windows añadidos; el resultado de Actions debe verificarse antes de cerrar el PR.

## Decisiones y límites

- **Ruling:** JSON de proyecto versionado con tiempos enteros en frames — mantiene el proyecto independiente del motor y evita problemas de precisión — las migraciones futuras serán obligatorias.
- **Ruling:** Remotion y FFmpeg son adaptadores de render, no garantías — el worker devuelve `unsupported` hasta que haya un render real implementado — este foundation no genera todavía MP4.
- **Ruling:** plugin de diálogos Tauri nativo; las rutas se validan en Rust — mantiene la frontera de archivos en el backend — falta prueba instalada en Windows.
- **Ruling:** no se inventó manualmente un lockfile npm. El entorno local no tiene acceso a internet y no tiene Cargo instalado; por ello CI usa `npm install`. El lockfile resuelto y revisado sigue siendo deuda de reproducibilidad antes de un lanzamiento.
- **Ruling:** no se puede afirmar que los tests Rust/Vitest pasaron localmente, porque no se pudieron ejecutar aquí. Los workflows Windows son la fuente de evidencia.
- **Ruling:** tests escritos antes de cerrar cada contrato, pero no se certifica observación del ciclo RED en esta sesión. El historial y los resultados de CI deben usarse como evidencia verificable.

## Gates antes del PR

1. TypeScript, UI y esquemas pasan en Windows.
2. `cargo fmt --all -- --check` y `cargo test -p editor-ia-desktop` pasan.
3. La app Tauri compila y el instalador NSIS se publica como artefacto no expirado.
4. El diff final no incluye claves, medios privados ni lockfiles inventados.
