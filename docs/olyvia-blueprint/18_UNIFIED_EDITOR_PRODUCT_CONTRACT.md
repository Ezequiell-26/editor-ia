---
date: 2026-11-13
status: product-target-and-execution-contract
authority: owner-approved-product-invariants
---

# 18 — Contrato objetivo: Olyvia como un único editor integrado

## 1. Propósito y jerarquía

Este documento reúne el resultado de producto que debe alcanzar Olyvia y traduce los hallazgos de la auditoría del 13-11-2026 en criterios de trabajo verificables para HY4.

Documentos que deben leerse juntos:
1. `docs/decisions/2026-11-13-permanent-editor-surface.md` — decisión vinculante del propietario: un solo editor, proyecto, Preview y Timeline.
2. `docs/olyvia-blueprint/00_MASTER_ARCHITECTURE.md` — arquitectura general.
3. `docs/olyvia-blueprint/02_FRONTEND_HY4_SPEC.md` — diseño y comportamiento visual.
4. `docs/olyvia-blueprint/11_FRONTEND_BACKEND_HANDOFF.md` — contratos frontend/backend.
5. `docs/olyvia-blueprint/12_COMPLETE_FEATURE_CATALOG.md` — catálogo de capacidades.
6. `docs/olyvia-blueprint/16_FEATURE_ACCEPTANCE_MATRIX.md` — aceptación por feature.
7. `docs/olyvia-blueprint/17_PERMANENT_EDITOR_FRONTEND_BUILD_PLAN.md` — plan por fases.
8. `docs/AUDITORIA-FRONTEND-ALAUKCUT-2026-11-13.md` — evidencia y hallazgos de HY4.

Si hay contradicción, prevalece la decisión del propietario del 13-11-2026. Este documento no declara que las capacidades ya estén implementadas.

## 2. Definición del producto terminado

Olyvia debe ser una aplicación de edición y creación audiovisual asistida por IA. El usuario trabaja en un único proyecto y en una única sesión de edición. Todas las herramientas actúan sobre ese proyecto, sus medios, secuencias, clips, capas, pistas, selección e historial.

La separación interna en módulos, servicios, motores o workers está permitida. La separación en experiencias de usuario independientes no está permitida.

### Invariantes no negociables

- Una sola sesión/editor principal por proyecto activo.
- Una sola Preview real, persistente y visible durante la edición.
- Una sola Timeline multipista real, persistente y sincronizada con Preview.
- Una sola biblioteca de medios del proyecto y una única selección compartida.
- Un único documento de proyecto y una fuente de verdad para playhead, selección, pistas, clips, historial y guardado.
- Las herramientas sólo cambian los controles contextuales, overlays o paneles; nunca reemplazan el editor.
- Los resultados se aplican al mismo proyecto y aparecen en la misma Preview/Timeline.
- Undo/redo, guardado, recuperación y cancelación deben funcionar de forma coherente.
- Los procesos largos pueden correr en background, pero se administran desde la sesión activa del editor.
- No se presentan mocks, valores inventados ni controles decorativos como funciones disponibles.
- Una capacidad no implementada se identifica claramente como parcial, experimental o no disponible.

## 3. Composición visual permanente

La aplicación debe conservar el diseño visual aprobado y organizar sus capacidades en estas regiones lógicas:

1. Barra superior: proyecto, secuencia, guardado, undo/redo, búsqueda/comandos, asistente y estado de tareas.
2. Navegación primaria: categorías y acceso a áreas; no crea editores alternativos.
3. Panel izquierdo / biblioteca: medios, efectos, títulos, transiciones, plantillas, recursos y generadores.
4. Toolbar contextual: acciones pertinentes a herramienta y selección actuales.
5. Monitor central: Preview del proyecto actual, siempre presente.
6. Inspector derecho: parámetros de clip, herramienta o selección activa.
7. Timeline inferior: pistas, clips, audio, texto, keyframes y overlays del mismo proyecto.
8. Asistente IA contextual: propone y ejecuta operaciones autorizadas sobre el proyecto actual.
9. Centro de actividad: jobs, progreso real, cancelación, errores y resultados.
10. Barra de estado: reproducción, rendimiento, medios offline, guardado y proveedor/motor.

La adaptación a pantallas pequeñas debe reorganizar o permitir colapsar paneles sin crear otra Preview, Timeline o workspace. La geometría visual aprobada no debe alterarse por una refactorización funcional no solicitada.

## 4. Catálogo funcional que debe integrarse

Todas estas capacidades deben abrirse dentro del mismo editor y operar sobre el contexto compartido:

- Edición base: seleccionar, mover, trim, split, ripple, copiar, pegar, borrar, crop, transform, velocidad y estabilización.
- Medios: importar archivos reales, organizar, buscar, previsualizar, metadatos, proxies y medios offline.
- Preview: reproducción real, scrub, overlays, guías, comparación y controles de calidad.
- Timeline: multipista, zoom, scroll, snapping, selección, agrupación, markers, audio waveforms y thumbnails.
- Texto: títulos, subtítulos, transcripción, traducción, estilos y sincronización.
- Audio: volumen, ganancia, pan, mixer, EQ, compresión, ducking, denoise, voz y loudness.
- Color: exposición, balance, curvas, HSL, LUT, scopes y máscaras.
- Motion/VFX: keyframes, curvas, transiciones, efectos, composición, nodos y multicámara.
- Tracking y máscaras: puntos, seguimiento, máscaras geométricas, plumilla y overlays sobre la Preview.
- IA: análisis, guion, storyboard, autoedición, sugerencias, generación y revisión.
- Descargas/conversión: importar al proyecto, descargar, convertir, comprimir y crear proxies con permisos claros.
- Exportación: presets, render, variantes, progreso, cancelación, validación y entrega.
- Integraciones: proveedores, MCP, conectores y permisos.

La presencia de un panel o botón no demuestra que una capacidad esté implementada. Cada elemento debe vincularse a una operación/servicio real, o mostrar su estado no disponible.

## 5. Contrato de interacción y datos

Toda herramienta debe:
1. Recibir un ID estable de herramienta y operación.
2. Leer el proyecto, secuencia, selección, clip/asset, pista y playhead compartidos.
3. Comprobar precondiciones, capacidades y permisos.
4. Mostrar controles con valores reales del proyecto/servicio.
5. Ejecutar una operación tipada existente; no inventar endpoints.
6. Mostrar progreso y resultado desde el backend/job real, sin timers simulados.
7. Aplicar el cambio al documento canónico y registrar undo/redo.
8. Actualizar la misma Preview y Timeline.
9. Permitir cancelar o cambiar de herramienta sin perder el proyecto ni trabajos persistidos.

No crear stores de proyecto paralelos por herramienta. No mantener un segundo reproductor, una timeline secundaria ni una selección/historial alternativos.

## 6. Resolución obligatoria de la réplica visual actual

La auditoría `docs/AUDITORIA-FRONTEND-ALAUKCUT-2026-11-13.md` identifica que `MinimalEditor.tsx` y `features/editor/minimal/` son una réplica visual basada en capturas, con datos simulados y controles sin acciones, montada sobre `EditorWorkspace`.

La réplica visual no puede seguir siendo presentada como editor de producción mientras sus controles sean decorativos.

Destino requerido:
- Conservar los patrones visuales aprobados de la réplica.
- Integrar esos patrones en los componentes productivos reales (biblioteca, Preview, Timeline, toolbar e inspector).
- Eliminar la duplicación de superficies y motores de reproducción.
- Sustituir timecodes, duración, playhead, guardado y contenido estáticos por datos del proyecto y playback reales.
- Conectar Importar a un flujo real de selección/importación de archivos, sólo si existe el contrato backend correspondiente.
- Conectar cada botón/menú a una acción real o representarlo claramente como no disponible; no dejar controles que aparenten funcionar.
- Retirar controles de QA/escenas de la build de producción, manteniendo los fixtures sólo en tests/desarrollo.
- No borrar `MinimalEditor` ni sobrescribir su WIP hasta revisar ownership, diffs y dependencias. Integrar por pasos y conservar evidencia visual.

## 7. Deuda transversal priorizada según auditoría

Los siguientes números son hallazgos reportados en la auditoría del 13-11-2026; deben revalidarse antes de cambios masivos y no son autorización para reescribir todo de una vez.

### P1 — Integridad funcional
- Doble superficie y doble motor al superponer `MinimalEditor` y `EditorWorkspace`.
- Estado de demostración hardcodeado.
- Botones de biblioteca, timeline y menús sin handlers reales.
- SceneNav de QA visible en producción.
- Marca AlaukCut/AC en el producto: revisión legal/de marca antes de distribuir; Olyvia debe usar identidad propia.

### P1 — CSS y sistema visual
- Cascada con miles de `!important`, selectores duplicados y múltiples sistemas visuales coexistentes.
- Tokens y colores con fuentes de verdad fragmentadas.
- Cobertura del tema claro muy inferior a la del oscuro.
- Migración progresiva, con baseline medible y sin cambiar de golpe la apariencia aprobada.

### P1 — Rendimiento
- Bundle inicial y CSS críticos pesados; fuentes emoji y módulos grandes cargados demasiado pronto.
- Definir presupuesto por ruta/chunk, carga bajo demanda y mediciones de arranque, idle y reproducción.
- Evaluar Lottie/CSP y separar módulos pesados sin romper la experiencia.

### P1 — Mantenibilidad
- Componentes monolíticos (Inspector, Timeline, DownloadView y otros).
- Crear plan de descomposición por módulo, con límites, consumidores, pruebas y entregas pequeñas.
- No hacer una reescritura masiva ni cambiar APIs públicas sin revisar consumidores.

### P2 — Robustez y estado
- Revisar catches silenciosos y registrar errores útiles sin filtrar secretos/rutas privadas.
- Aplicar sanitización sistémica de errores visibles.
- Validar estructura de datos persistidos antes de convertirlos a tipos.
- Reducir divergencia de preferencias y estado sólo con una migración diseñada; no reemplazar todos los stores por uno nuevo sin análisis.

### P2 — Rendimiento de interacción y accesibilidad
- Virtualizar listas grandes de clips, assets, ticks y marcadores donde las mediciones lo justifiquen.
- Corregir targets no accesibles por teclado y mantener focus-visible/ARIA.
- Añadir pruebas de tema claro, resoluciones mínimas y ventana nativa.

### P0 de validación — Prueba real de extremo a extremo
- Ejecutar la aplicación Tauri real.
- Abrir/crear un proyecto con medios reales.
- Importar → editar → reproducir/scrub → guardar → cerrar/reabrir → exportar.
- Capturar la interfaz con proyecto y contenido real, no sólo empty states.
- Verificar persistencia de identidad/montaje de Preview y Timeline al activar herramientas.
- Verificar undo/redo, cancelación y errores.

## 8. Secuencia de ejecución y gates

### Etapa A — Baseline y mapa real
- Revisar rama, status, diffs y procesos concurrentes.
- Clasificar cada control y feature: real, parcial, mock/demo, decorativo, backend unavailable o no verificado.
- Mapear el montaje y la identidad de EditorWorkspace, Preview, Timeline y stores.
- Capturar el editor real con proyecto abierto.
- No borrar, limpiar ni sobrescribir WIP.

### Etapa B — Editor visual único
- Eliminar la superposición de dos superficies mediante una migración segura.
- Integrar el diseño aprobado en componentes productivos.
- Mantener Preview y Timeline únicas, visibles y persistentes.
- Corregir navegación contextual sin duplicar el registry.
- Gate: pruebas de identidad de componentes y captura visual real.

### Etapa C — Controles honestos y contratos
- Conectar sólo operaciones para las que exista API/servicio real y validado.
- Reemplazar valores simulados por estado real.
- Documentar gaps de backend para SWE 2 con contrato requerido.
- No usar mocks en producción ni inventar endpoints.
- Gate: cada control marcado como real tiene prueba de comportamiento; los no disponibles están explícitos.

### Etapa D — Unificación funcional progresiva
- Integrar herramienta por herramienta sobre el mismo proyecto, selección, playhead e historial.
- Confirmar aplicación de resultados, guardado y undo/redo.
- No iniciar una migración masiva; cada grupo necesita aceptación y pruebas.
- Esta etapa requiere aprobación explícita del propietario del producto según la decisión canónica.

### Etapa E — Calidad sistémica
- Reducir CSS conflictivo con baseline decreciente.
- Optimizar bundle por ruta y virtualizar listas medidas.
- Dividir módulos gigantes con pruebas de regresión.
- Mejorar errores, persistencia, accesibilidad, responsive y tema claro.
- Gate: typecheck, tests focalizados, suite completa pertinente, build, E2E y capturas antes/después.

## 9. Reglas para HY4 y otros agentes

- Leer este documento y los ocho documentos de referencia antes de ejecutar una fase.
- Trabajar sólo dentro del ownership autorizado.
- Antes de editar: revisar branch, status y diff de cada archivo afectado.
- Preservar los cambios locales y los archivos no trackeados; no asumir que son descartables.
- No usar `git reset`, `git clean`, borrado masivo, commit ni push.
- No editar backend/Rust/Tauri para compensar un contrato ausente; registrar el gap a SWE 2.
- No afirmar que una feature funciona por tener UI, test de render o build exitoso.
- Informar archivos tocados, pruebas ejecutadas, evidencia visual y limitaciones.
- Si una operación es riesgosa o el ownership no está claro, detenerse y pedir decisión.
- No declarar Olyvia terminada hasta superar el flujo E2E real de la sección 7.

## 10. Estado de este contrato

Este documento define el objetivo y el procedimiento; no certifica que el trabajo esté implementado. La auditoría de HY4 es evidencia de una revisión concreta, pero sus métricas deben revalidarse al comenzar cada fase porque el working tree cambia.

**Estado actual conocido:** la arquitectura objetivo está documentada; la unificación efectiva del código y la validación visual/funcional con Tauri y un proyecto real siguen pendientes.
