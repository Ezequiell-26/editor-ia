# HY4 — Encargo de implementación del frontend de Olyvia

Sos responsable exclusivo del frontend de Olyvia en el worktree de arquitectura.

## Lectura obligatoria
1. docs/olyvia-blueprint/README.md
2. docs/olyvia-blueprint/01_PRODUCT_VISION.md
3. docs/olyvia-blueprint/02_FRONTEND_HY4_SPEC.md
4. docs/olyvia-blueprint/09_IMPLEMENTATION_ROADMAP_AND_ACCEPTANCE.md
5. docs/olyvia-blueprint/11_FRONTEND_BACKEND_HANDOFF.md
6. docs/AUDITORIA-FRONTEND-2026-11-07.md y docs/APP-FEATURE-AUDIT.md como auditorías históricas que debes revalidar.

## Objetivo
Construir la experiencia visual y de interacción completa definida en la especificación. Olyvia debe parecer un estudio creativo profesional, claro y coherente, con Estudio IA y Editor manual dentro de la misma aplicación.

## Límites estrictos
- Trabajar sólo en apps/desktop/src/** y los recursos estrictamente visuales del frontend que sean necesarios.
- No modificar Rust, Tauri commands, registry IPC, schemas compartidos, workers, FFmpeg, proveedores, credenciales ni lógica de backend.
- No crear endpoints falsos, respuestas simuladas presentadas como reales ni botones decorativos.
- No copiar componentes enteros de otros repositorios ni alterar licencias.
- No borrar funcionalidades existentes sólo para simplificar la navegación.
- No tocar archivos con cambios locales ajenos. Antes de mover, renombrar o eliminar un archivo, revisar diff y ownership del cambio.
- No hacer reset, clean, borrados masivos, commit ni push.
- No ejecutar comandos destructivos ni parar procesos concurrentes.

## Descubrimiento antes de diseñar
1. Revisar git status, branch, diff y procesos.
2. Inspeccionar capturas en editor-ia-shots/ y .tmp-theme-shots/.
3. Abrir la app actual a 1360×768 y capturar el estado inicial.
4. Recorrer Inicio, Crear, Editor, Medios, Exportaciones, Ajustes, Assistant y Production.
5. Inventariar las features actuales y mapearlas a las áreas de información nuevas.
6. Identificar qué servicios existen realmente y cuáles faltan. No deducir disponibilidad por nombres de componentes.
7. Medir overflow, tipografía, contraste, scroll, densidad y tamaño de panel.

## Estrategia
- Definir primero tokens y shell, luego navegación, workspaces, componentes comunes y estados.
- Construir por flujos verticales de frontend, no por pantallas aisladas sin interacción.
- Mantener fachadas e interfaces existentes; cualquier incompatibilidad se reporta a SWE 2 como contrato requerido.
- Usar fixtures/mock sólo en tests y en stories locales claramente etiquetadas; no ofrecerlos como capacidad de producción.
- Persistir preferencias UI en el mecanismo establecido; no persistir operaciones de edición sólo en estado local.
- No implementar lógica de edición ni cálculos que pertenecen al dominio/backend.
- UI debe soportar cancelación/estado/progreso según contratos de jobs, no emularlos mediante timers.

## Entrega por fase
Para cada fase:
- Lista de archivos cambiados.
- Qué pantallas/comportamientos se completaron.
- Capturas antes/después.
- Typecheck y tests focalizados.
- Playwright/e2e cuando aplique.
- Problemas de backend identificados, con contrato esperado y ejemplo de request/response.
- Limitaciones conocidas.

## Resultado requerido
1. Shell y navegación unificados.
2. Inicio y flujo Crear.
3. Plan/Storyboard/Production Runs.
4. Biblioteca de medios y derechos.
5. Editor con layout profesional, timeline y preview.
6. Herramientas de texto, audio, color, motion/VFX y multicam accesibles.
7. Assistant contextual.
8. Ajustes de proveedores/MCP y permisos.
9. Exportaciones/entregas.
10. Accesibilidad, responsive desktop y performance.

No declares la app lista por cantidad de páginas. La aceptación se basa en los flujos reales, los contratos y las pruebas del documento 09.
## 7. Alcance completo y entrega

Además de los documentos de lectura originales, leer:
- docs/olyvia-blueprint/12_COMPLETE_FEATURE_CATALOG.md
- docs/olyvia-blueprint/13_FINAL_PROJECT_DELIVERY_CONTRACT.md
- docs/olyvia-blueprint/14_AGENT_EXECUTION_PROTOCOL.md
6. docs/olyvia-blueprint/16_FEATURE_ACCEPTANCE_MATRIX.md

No termines entregando sólo wireframes, análisis o una lista de tareas. Ejecuta todas las fases de frontend que correspondan a tu ownership hasta que la UI esté conectada a los servicios reales, probada y documentada. Entrega capturas antes/después, pruebas visuales y lista exacta de endpoints. No modifiques la parte nativa Tauri para resolver la ventana redimensionable: registra el contrato a SWE 2.