# 09 — Roadmap, dependencias y criterios de aceptación

## 1. Ejecución paralela, integración controlada

HY4 y SWE 2 pueden trabajar en paralelo sólo después de acordar contratos:
- SWE 2 publica schemas, IPC, job lifecycle, event names, error codes y capabilities.
- HY4 consume esos contratos y construye la UI.
- Los tests de integración verifican ambos sentidos.
- Ningún agente modifica el dominio del otro para destrabar una interfaz sin documentar el cambio.
- Si un contrato cambia, generar versión/migración y actualizar el brief de integración.

## 2. Orden de fases

| Fase | Dueño primario | Entregable | Gate de salida |
|---|---|---|---|
| 0. Baseline/worktree | SWE 2 | Aislamiento de dependencias, status report y baseline reproducible | typecheck/build/test ejecutados sobre esta rama sin resolver imports desde main por error |
| 1. Contratos del estudio | SWE 2 | Plan, run, job, events, errors, capabilities y rights schema | schema round-trip y contract tests |
| 2. UI shell/design system | HY4 | Navegación, shell, tokens, layout y estados | capturas comparadas, 1360×768 y 1280×720 sin overflow |
| 3. Planner natural-language | SWE 2 | Brief -> intent -> guion -> storyboard -> ProductionPlan | E2E de plan con salida schema-valid y revisión |
| 4. Production worker | SWE 2 | Scheduler, checkpoints, cancelación y restart recovery | ocultar ventana no interrumpe; restart reanuda según policy; cancel termina procesos |
| 5. Creator UI | HY4 | Brief, plan review, storyboard, asset management y run center | flujo UI usa jobs reales y muestra error/cost/status |
| 6. Provider adapters | SWE 2 | Imagen, vídeo, audio, TTS, STT, música/SFX, vision | contract + live tests con autorización, output probe y costo registrado |
| 7. Acquisition/rights | SWE 2 | Catálogos y licencias por asset | rechaza assets no aptos para comercial y muestra atribución |
| 8. Editor integration | HY4 + SWE 2 | UI expone operaciones existentes sobre mismo proyecto | cambios del estudio abren en editor manual sin pérdida de datos |
| 9. Quality & delivery | SWE 2 | Quality Gate, repair loop, manifest y bundle | vídeo probado, informe, re-open project y hash |
| 10. MCP autonomy | SWE 2 | tools plan/run/status/cancel/resume/deliverables | cliente MCP real completa caso de uso con permisos |
| 11. Release/security | SWE 2 | package, licenses, security audit, performance | smoke test en Windows y report medido |
| 12. Usability polish | HY4 | refinamiento visual, accesibilidad y onboarding | sesiones completas y cero bloqueos P0/P1 abiertos |

No pasar a fases dependientes con contratos sin cerrar. El plan no obliga a hacer una fase por semana ni promete una fecha de finalización.

## 3. Fase 0 — Exactitud del repositorio

1. Confirmar branch, HEAD, status, diff, upstream y worktrees.
2. Identificar junctions/symlinks de node_modules y validar a qué repo apuntan.
3. Ejecutar package manager install sólo si hay lockfile y motivo; evitar reinstalación indiscriminada.
4. Pasar typecheck, build, unit tests, Rust tests y E2E por separado.
5. Registrar baseline y diferencias con CI.
6. No comparar test counts de main con architecture como si fueran el mismo código.

## 4. Escenarios E2E obligatorios

### A. Crear desde texto
Brief: vídeo tutorial de 60–90 s, español, 16:9, material mixto.
Expected: intent, script, storyboard, plan validado, recursos, timeline, captions, render, quality report, editable project y manifest.

### B. Historia con imágenes y voz del usuario
Input: audio narrado y carpeta de imágenes.
Expected: transcript/alignment, scene beats, asociación de imágenes, pan/zoom por escena, música/SFX opcionales, captions y sincronización. El sistema no debe regenerar voz si el usuario no lo pidió.

### C. Crear desde cero con generación remota
Input: brief y referencias aprobadas.
Expected: cost estimate y aprobación; image/video adapter real; async jobs; rights/model provenance; verify media; assemble.

### D. Editar proyecto existente
Input: proyecto real, instrucción “recorta silencios, mejora el ritmo y agrega subtítulos”.
Expected: análisis, plan de cambios, preview diff, aplicar operations, undo, render y report.

### E. Shorts/Reels/TikTok
Expected: detectar segmentos, reencuadrar, captions, safe area, varias variantes y reporte; usuario elige final.

### F. Stickman / meme / motion
Expected: guion, assets del personaje, rig/keyframes, gráficos y SFX sincronizados; salida editable.

### G. Tutorial confidencial
Expected: identificar regiones sensibles según indicación del usuario, blur/cover, confirmación antes de upload externo y revisión final de privacidad.

### H. Documental/investigación
Expected: fuentes trazables, claims asociados a fuente, diferenciación de cita/inferencia y revisión humana de afirmaciones.

### I. Crear anuncio
Expected: brand assets, claims autorizados, safe areas, derechos, voice/tone, variantes y revisión; no inventar garantías.

### J. Reanudar tras interrupción
Expected: matar app durante job según entorno de prueba, reabrir, leer checkpoint, no duplicar cargos/assets/clips y ofrecer resume/inspect.

## 5. Gates por área

### Planner
- JSON/schema valid.
- IDs estables.
- Duraciones/timecodes dentro de límites.
- Resource requirements completables o explícitamente blocked.
- Estimación de costo calculada o marcada unknown.
- No claim externo sin fuente cuando el brief lo exige.

### Acquisition/generation
- Consent válido.
- Derechos revisados.
- Job ID persistido.
- Resultado descargado y probed.
- Hash, model/provider/version y costo registrados.
- Retry no crea salida duplicada.

### Editing/assembly
- IDs de clips/tracks estables.
- Source in/out válidos.
- Duración scene target razonable.
- Timeline se reabre igual.
- Undo group revierte lote IA.
- Preview coincide con parámetros de export relevantes.

### Render
- Archivo no vacío.
- FFprobe legible y metadata esperada.
- Decode test sin error.
- Frame count/duration dentro de tolerancia.
- Resolución/fps/ratio/crop correctos.
- Audio streams y loudness/true peak dentro del preset.
- Captions presentes y sincronizados.
- No hay media faltante ni black/frozen frames inesperados.
- Hash/manifest generado después de verificar.

### Delivery
- Proyecto se abre en Olyvia.
- Rutas relativas/portable media comprobadas o claramente listadas.
- Todos los recursos licenciados y atribuibles.
- ZIP path-safe y checksums.
- La carpeta final tiene contenido esperado y ningún secreto.

## 6. Métricas de producto

Registrar, no inventar:
- Tiempo desde brief hasta preview.
- Tiempo de generación por provider y costo real.
- Proporción de runs completados y reason codes de fallos.
- Número de reparaciones y re-renders.
- Cancelation latency.
- Recovery success rate.
- Render speed ratio y output quality.
- RAM/CPU/GPU/disk peak.
- Errores UI, overflow y navegación por keyboard.
- Tiempo para crear proyecto y localizar una herramienta.

## 7. Criterio global de beta útil

Un beta útil no requiere emular todo DaVinci. Requiere al menos:
1. Crear un vídeo completo desde brief con providers disponibles.
2. Editar manualmente la salida en el mismo proyecto.
3. Importar y editar material del usuario.
4. Revisar y entregar un MP4 correctamente validado.
5. Persistir/reanudar jobs con límites honestos.
6. Exponer acciones autónomas por MCP de forma segura.
7. Funcionar con proveedor remoto y sin modelo local de imagen/vídeo.
8. Mostrar capacidades no disponibles en vez de fingirlas.

## 8. Cómo reportar avance

Por cada capacidad reportar:
- Estado: REAL / PARCIAL / GAP / BLOCKED / NOT EVALUATED.
- Qué usuario puede hacer exactamente.
- Qué se verificó y con qué comando/test.
- Qué artefacto se produjo.
- Qué limitación queda.
- Archivos y contratos modificados.
- Costo/licencia/performance si aplica.

No usar “100% autónomo”, “background 24/7” ni “profesional completo” sin matriz medible y verificación independiente.
## 9. Entrega final obligatoria

La misión de los agentes incluye entregar una build real. Seguir docs/olyvia-blueprint/13_FINAL_PROJECT_DELIVERY_CONTRACT.md y el protocolo de continuidad 14_AGENT_EXECUTION_PROTOCOL.md. El resultado debe incluir instalador NSIS, SHA256SUMS, manifest, reportes, guías, sample project y capturas. No cerrar la tarea respondiendo sólo con cambios de código o con una lista de lo que falta.

## 10. Matriz de aceptación por capability ID

Cada fase debe actualizar docs/olyvia-blueprint/16_FEATURE_ACCEPTANCE_MATRIX.md. No cerrar la fase global si quedan IDs P0/P1 en FAIL o NOT EVALUATED. Los bloqueos externos se identifican con la acción exacta que el usuario debe realizar.
