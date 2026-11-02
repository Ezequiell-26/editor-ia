# Acceso a rutas completas del equipo, eficiencia de tokens y contraste de guías — 2026-11-01

## Qué se hizo

1. **Acceso directo al sistema de archivos local para la IA / Asistente Olyvia**:
   - `list_media_folder` en `media.rs` ahora detecta si la ruta provista es un directorio existente en el equipo (`PathBuf::from(trimmed).is_dir()`) y extrae directamente sus medios (imágenes, audios y videos hasta 2 niveles de profundidad, filtrando archivos no multimedia).
   - Se mantiene la compatibilidad y seguridad con carpetas relativas de Descargas (`sanitize_media_folder_name`).
   - El operador local `parseOperatorCommand` en `operator.ts` ahora detecta rutas absolutas con unidades Windows (`D:\...`, `C:\...`) o POSIX y preserva las mayúsculas/minúsculas originales sin pasar por APIs remotas.
   - `mountMediaFolder` en `AssistantDock.tsx` admite rutas absolutas, extrae el nombre del directorio para crear el proyecto (ej. `D:\Videos\Clips` -> `Clips`) y monta la narración sincronizada.

2. **Eficiencia en consumo de tokens**:
   - Control de reproducción, navegación entre vistas, creación de motion templates y montaje de medios locales se resuelven en el frontend de forma determinista con **0 tokens**.
   - El análisis visual de imagen ([image_sense.rs](file:///d:/Users/ofici/QODER-WORK/editor-ia/apps/desktop/src-tauri/src/commands/image_sense.rs)) se realiza en el equipo con Rust en milisegundos sin llamadas de visión caras.
   - Las consultas a LLM solo envían descripciones textuales ultra-compactas (`describeForPrompt`), evitando gastar tokens en imágenes completas codificadas en base64.

3. **Corrección de corte en planificador de narración**:
   - En `narration-plan.ts`, se ajustó `minSentenceSeconds` de `0.9` s a `0.7` s. Frases cortas completas de puntuación (p. ej. *"Hola mundo."* de 0.8 s) ya no colapsan en la siguiente.

4. **Accesibilidad de contraste de guías de curvas (Ítem 10b)**:
   - En `KeyframeCurveEditor.tsx`, se definieron y exportaron `GUIDE_CENTER_COLOR` (`#6b7480`, ratio 4,03:1) y `GUIDE_BOUNDS_COLOR` (`#7b8591`, ratio 5,10:1) sobre `#0a0f1e`, cumpliendo WCAG 2.1 SC 1.4.11 (>= 3:1).
   - Ítem 10b actualizado a `[done]` en `docs/IMPROVEMENT-QUEUE.md`.

## Evidencia de pruebas

- `commands::media::tests`: **4/4 passed** en Rust (incluyendo `list_media_folder_accepts_existing_absolute_dir`).
- `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop`: **457 passed, 0 failed, 48 ignored**.
- `apps/desktop/src/features/assistant/AssistantDock.test.tsx`: **5/5 passed** (incluyendo `monta una ruta absoluta del equipo`).
- `apps/desktop/src/features/ai-hub/operator.test.ts`: **5/5 passed** (reconocimiento de rutas absolutas).
- `apps/desktop/src/features/editor/KeyframeCurveEditor.test.tsx`: **12/12 passed** (incluyendo prueba matemática de ratio de contraste).
- `apps/desktop/src/state/narration-plan.test.ts`: **6/6 passed**.
- `npm run typecheck`: **0 errores** en los 3 workspaces.
