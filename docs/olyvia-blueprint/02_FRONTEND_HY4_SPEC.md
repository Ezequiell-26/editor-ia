# 02 — Especificación completa del frontend para HY4

**Responsable:** HY4.  
**Ámbito:** interfaz de escritorio React/TypeScript, UX, diseño visual, accesibilidad y estados.  
**Fuera de alcance:** implementar Rust, Tauri commands, FFmpeg, workers, APIs de IA, adquisición o lógica de dominio. HY4 integra servicios definidos por contratos y registra brechas del backend.

## 1. Objetivo visual

Diseñar Olyvia como un **estudio de edición profesional contemporáneo**, con la facilidad de un flujo creativo guiado y la densidad funcional de una NLE. No debe parecer una copia literal de CapCut, Filmora o DaVinci; se estudian sus patrones de jerarquía, paneles, navegación y controles, y se crea una identidad Olyvia coherente.

### Referencias locales obligatorias

Antes de diseñar:
- Revisar las imágenes de **editor-ia-shots/** (30 referencias observadas) y **.tmp-theme-shots/** (18 referencias observadas).
- Priorizar las capturas Olyvia del 2026-11-03: home, editor/timeline, ajustes y launcher.
- Revisar ai-panel.png, autoedit-final.png, autoedit-variants.png, capturas de mezclador, multicámara, Flow queue y configuración.
- Consultar las auditorías docs/AUDITORIA-FRONTEND-2026-11-07.md y docs/APP-FEATURE-AUDIT.md; sus métricas son históricas y deben volver a medirse.
- Inspeccionar la aplicación actual en ejecución a 1360×768 antes de definir la geometría final.

No descartar las referencias por estética personal. Registrar qué patrón se reutiliza, qué se corrige y por qué.

## 2. Entorno objetivo y geometría

La pantalla de referencia de desarrollo es 1360×768, por el equipo de baja gama y resolución observados. La UI debe funcionar desde 1280×720 y escalar hacia 1920×1080 o más.

- Barra de título/sistema: altura compacta, respetar comportamiento nativo de Tauri.
- Navegación principal: rail lateral de 64–76 px o sidebar expandible de 190–230 px.
- Header del workspace: 48–56 px.
- Área central: flexible y con scroll propio, nunca empuja la timeline fuera de pantalla.
- Inspector derecho en editor: 300–360 px, colapsable y redimensionable.
- Panel izquierdo de assets/herramientas: 220–280 px, colapsable.
- Timeline: 230–300 px por defecto, altura redimensionable.
- Preview: usar el espacio sobrante; preservar ratio y letterboxing correcto.
- No permitir overflow horizontal global ni clipping de controles esenciales.
- Priorizar paneles acoplados y splitter persistido; evitar modal para tareas frecuentes.

La geometría es punto de partida, no absolutos: medir con capturas y pruebas en viewport pequeño.

## 3. Arquitectura de información

Reducir la fragmentación actual. Las más de treinta features existentes se deben agrupar en tareas reconocibles sin eliminar su funcionalidad.

### Navegación primaria

1. **Inicio** — proyectos recientes, crear nuevo, continuar trabajos y estado del estudio.
2. **Crear** — flujo guiado de producción IA.
3. **Editor** — editor multipista y herramientas profesionales.
4. **Medios** — biblioteca, importación, búsqueda, descargas y derechos.
5. **Exportaciones** — cola, entregas, variantes y recuperación.
6. **Ajustes** — proveedores, modelos, MCP, apariencia, rendimiento, privacidad y licencias.

El chat asistente debe ser accesible desde el header/rail y contextual al proyecto. No debe competir como una segunda aplicación desconectada.

### Herramientas dentro del contexto

- Dentro de Editor: montaje, texto/subtítulos, audio, color, motion/VFX, multicámara, nodos, scopes, proxies, exportación.
- Dentro de Crear: brief, guion, investigación, storyboard, medios, voz/audio, montaje, revisión y entrega.
- Dentro de Medios: biblioteca local, catálogo remoto, metadatos, búsqueda, atribución, licencias y estado de descarga.
- Dentro de Ajustes: catálogo de proveedores, credenciales seguras (nunca mostrar secretos completos), modelos, capacidades, costos, conexión MCP y permisos.

No crear 30 elementos principales ni esconder funciones profesionales en menús arbitrarios. La navegación secundaria debe ser contextual, buscable y consistente.

## 4. Shell global

### Header
- Nombre/logo Olyvia y nombre del proyecto activo.
- Migas o contexto de ubicación dentro del workspace.
- Estado de guardado y sincronización local.
- Deshacer/rehacer cuando el contexto lo permita.
- Botón de asistente IA que conserva conversación y selección contextual.
- Estado de tarea activa, cola y notificaciones.
- Acceso a ayuda y ajustes.

### Sidebar
- Secciones y subherramientas agrupadas.
- Estados activos inequívocos.
- Tooltips con nombre completo para rail compacto.
- Accesos recientes y favoritos configurables.
- Búsqueda de comandos con atajo Ctrl+K.
- No duplicar entradas de navegación en menús superiores e inferiores.

### Área central
- Cada vista define título, descripción breve, acción primaria y contenido.
- Acciones deshabilitadas explican el requisito que falta.
- Loading, empty, error, offline, permission-denied y success son estados diseñados, no excepciones invisibles.
- No usar datos ficticios que parezcan datos reales.

## 5. Pantallas obligatorias

### 5.1 Inicio
- CTA primario “Crear vídeo con IA”.
- CTA secundario “Abrir proyecto” e “Importar medios”.
- Proyectos recientes con miniatura, formato, última edición y estado.
- Trabajos de producción activos y recuperables.
- Plantillas por objetivo: tutorial, historia, short, anuncio, documental, meme, presentación, gameplay.
- Centro de actividad compacto.
- No mostrar tarjetas de “listo” si un servicio está offline o no disponible.

### 5.2 Crear proyecto / Brief
Formulario por pasos, no una pared de inputs:
1. Objetivo y tipo de vídeo.
2. Audiencia, plataforma, idioma y tono.
3. Duración, formato y estilo visual.
4. Material propio y referencias.
5. Narración, música y subtítulos.
6. Presupuesto y proveedores permitidos.
7. Resumen y confirmación.

Permitir texto libre además de controles. Recordar preferencias por proyecto y exponer defaults editables. Indicar qué opciones activan servicios de pago.

### 5.3 Plan creativo
- Columna de guion / narrativa.
- Storyboard central por escena.
- Inspector de escena: objetivo, duración, narración, recursos, transición, texto y nota de continuidad.
- Presupuesto estimado y dependencias.
- Indicador “requiere aprobación”.
- Acciones: editar, regenerar sólo escena, reordenar, duplicar, aprobar, volver al brief.
- No generar recursos costosos hasta aprobar el plan si así está configurado.

### 5.4 Biblioteca de medios
- Grid/listado con thumbnails, duración, dimensiones, tipo, codec y origen.
- Filtros locales/remotos, vídeo/imagen/audio, fecha, licencia, orientación y favoritos.
- Panel de preview y metadatos.
- Estado: local, descargando, descargado, fallido, requiere atribución, sin derechos confirmados.
- Búsqueda global y selección múltiple.
- Acciones de importación, proxy, analizar, vincular a escena y abrir carpeta.
- Mostrar procedencia y licencia de cada asset; nunca asumir licencia por proveedor.

### 5.5 Estudio de producción autónoma
- Lista de runs y su estado persistente.
- Detalle con brief, plan, etapas, progreso, costo, logs saneados y entregables.
- Acciones contextuales: pausar, cancelar, reanudar, revisar plan, avanzar si requiere aprobación, abrir proyecto.
- Estado por etapa: pendiente, en ejecución, bloqueada, completada, fallida, cancelada.
- Mostrar qué está esperando (aprobación, clave, red, recurso, cuota, espacio).
- No confundir “ocultar ventana” con cancelar.
- Si el backend aún no mantiene worker durable, mostrar “la ejecución depende de que Olyvia permanezca abierta”; no mentir con modo background.

### 5.6 Editor principal
Composición recomendada:
- Izquierda: panel de medios, efectos, títulos, transiciones y plantillas, según pestaña.
- Centro arriba: monitor de preview con play/pause, step frame, timecode, zoom, safe areas, calidad de preview.
- Derecha: inspector contextual del clip/escena/capa seleccionada.
- Abajo: timeline multipista con ruler, playhead, tracks, clips, waveform, subtítulos, keyframes y marcadores.
- Header local: nombre de secuencia, fps, resolución, estado de guardado, historial.
- Modo maximizado para monitor y modo timeline extendida.

La selección debe ser consistente entre timeline, preview, biblioteca e inspector. Ninguna vista paralela debe mantener un segundo estado de clip incompatible.

#### Timeline
- Tracks con tipo e icono y controles de mute/lock/visibility.
- Clips con waveform/thumbnail y etiquetas.
- Split, trim, slip, slide, ripple, snapping, multi-select, group, duplicate y markers.
- Zoom, scroll, auto-scroll y navegación por timecode.
- Keyframes visibles, seleccionables y editables.
- Drop targets claros y drag accesible por teclado donde sea posible.
- Virtualizar grandes secuencias sin perder selección.
- Renderizar previews ligeras; nunca cargar la totalidad de medios o waveforms gigantes de golpe.

#### Monitor
- Frame correcto en el timecode solicitado.
- Guías, safe areas, overlays y transform gizmos.
- Comparación antes/después para efectos.
- No utilizar un poster estático como preview de reproducción real.
- Indicadores visibles cuando se trata de proxy, frame cacheado o preview degradado.

#### Inspector
- Cambia por tipo de selección; mantiene orden y control consistente.
- Secciones plegables, campos numéricos con unidades, tooltips y valores originales/restaurar.
- Controles conectados a comandos/estado persistente; prohibido guardar silenciosamente valores de producción sólo en useState local.
- Sliders con teclado, step y entrada numérica.
- Usar coma decimal en interfaz es-AR y guardar valores numéricos normalizados.

### 5.7 Herramientas profesionales
Integrar en una estructura común sin duplicar motor ni diseño:
- Subtítulos: transcripción, edición, estilos, traducción, diarización y export.
- Audio: mixer, gain, EQ, compresión, ducking, denoise, aislamiento, loudness, waveform y scopes.
- Color: primary wheels, exposición, temperatura, tint, curvas, HSL, LUTs, scopes, máscaras y comparación.
- Motion/VFX: transform, keyframes, curvas, títulos, Lottie, partículas, rig 2D, máscaras y tracking.
- Multicam y sincronización.
- Nodos/grafos cuando el usuario necesite composición avanzada.
- Proxies, conversión, compresión y transcodificación.
- Descarga de medios y conversión de formatos.

No crear una versión duplicada de controles que ya tenga el editor. Elegir un componente propietario por función y reutilizarlo.

### 5.8 Asistente IA contextual
- Conversación enlazada al proyecto, selección y playhead.
- Composer con texto, adjuntos y acciones sugeridas relevantes al contexto.
- Mensajes de progreso separados del contenido final.
- Mostrar el plan de operaciones antes de aplicar cambios importantes.
- Cada respuesta de acción muestra resultado, warning o motivo de bloqueo.
- Preview diff y undo de cambios cuando sea posible.
- Panel de herramientas disponibles con capacidad declarada, no promesas.
- Permitir alternar proveedor/modelo y presupuesto según permisos.
- No mostrar chain of thought ni razonamiento privado; sí un resumen verificable de qué hará y qué cambió.

### 5.9 MCP y proveedores
- Catálogo de servidores MCP con nombre, transporte, estado, última conexión, permisos y herramientas descubiertas.
- Test de conexión, refresh, enable/disable y diagnóstico.
- Permisos por servidor y por herramienta.
- El token no se muestra completo; copiar/regenerar sólo mediante flujo seguro.
- Catálogo AI: proveedor, endpoint, modelo, modalidades, límites y test.
- No declarar conectado hasta recibir handshake o comprobación real.

### 5.10 Exportar y entregar
- Presets de plataforma, resolución, FPS, codec, bitrate/quality, audio y captions.
- Estimación de tamaño y tiempo sólo si hay medida o modelo fundamentado.
- Barra de progreso con cancelación.
- Cola de trabajos, errores accionables y retry.
- Verificación del MP4 final: probe, duración, resolución, fps, streams, audio, tamaño y hash.
- Entrega con proyecto editable, manifiesto, captions y reporte de derechos.
- Preview final antes de cerrar el flujo.

### 5.11 Ajustes
Secciones: General, Apariencia, Proyecto, Rendimiento, IA y proveedores, Modelos, MCP, Descargas, Audio y voz, Exportación, Privacidad, Licencias, Actualizaciones.
- Claves nunca visibles después de guardadas.
- Mostrar conectividad, capacidad declarada y límites.
- Import/export de configuraciones sin secretos.
- Diagnóstico de entorno con rutas saneadas.

## 6. Sistema visual y tipografía

- Tema base oscuro neutro de contraste suficiente; tema claro opcional.
- Acento de marca Olyvia consistente; validar con las capturas reales existentes, no inventar una paleta arbitraria sin comparar.
- Tipografía de UI legible y nítida; usar system font o familia local con licencia verificada. Jerarquías claras, números tabulares en timecode/valores.
- Tamaño base 13–14 px para UI densa; labels secundarios no menores de 11–12 px, salvo metadatos no críticos.
- Separadores, superficies y estados se distinguen sin abusar de blur/glassmorphism.
- No usar gradientes y animaciones en todos los paneles; movimiento sutil y con función.
- Focus ring visible, hover, pressed, disabled, loading y selected diferenciados.
- Iconografía consistente (un mismo set, mismos tamaños y stroke).
- Densidad profesional, pero con separación visual para que texto pequeño no se vea borroso.

## 7. Componentes de sistema

Definir y documentar tokens de color, tipografía, spacing, radius, shadow, motion, z-index y breakpoints.
Componentes base: Button, IconButton, Tooltip, Tabs, SegmentedControl, Dropdown, Combobox, Slider, NumericInput, ColorInput, Checkbox, Radio, Switch, Dialog, Drawer, Popover, Toast, Alert, Progress, Skeleton, EmptyState, ErrorState, StatusBadge, DataTable, VirtualGrid, SplitPane, Resizer, SearchField, MediaThumbnail, TimecodeInput, TrackHeader, TimelineClip, Waveform, KeyframeLane, ProviderCard, JobStep, CostEstimate, PermissionNotice.
- Todos deben respetar tokens y focus.
- No incorporar librerías duplicadas por conveniencia.
- Mantener façade y exports públicos estables durante refactor.

## 8. Estados y contratos de UI

Cada acción debe tener:
- ID/command y contrato de request/response.
- Estado idle, loading, success, error, unavailable, blocked, cancelled.
- Mensaje útil y retry policy cuando sea seguro.
- Resultado persistido cuando aplique.
- Permiso y costo visible cuando corresponde.

No ocultar fallos con catch vacío. Distinguir “sin proveedor configurado”, “proveedor offline”, “modelo no admite imagen”, “cuota agotada”, “permiso denegado” y “recurso no encontrado”.

## 9. Accesibilidad y experiencia

- Navegación completa por teclado en menús, inspector y timeline.
- Labels ARIA, foco restaurado en diálogos, contraste WCAG AA como objetivo.
- No comunicar estado sólo por color.
- Hotkeys consistentes y visibles.
- Formatos regionales es-AR sin cambiar el formato interno.
- Confirmación para operaciones destructivas y diálogo con descripción real.
- Undo para edición; confirmación no reemplaza la reversibilidad.
- No esconder mensajes de error importantes dentro de logs.

## 10. Performance frontend

- Lazy load por workspace y panel pesado.
- Virtualizar colecciones grandes.
- Memoización/selectores estables; evitar render global al mover playhead.
- Estado de reproducción separado del estado estructural del proyecto.
- No enviar media binaria o frames grandes por estado global React.
- Debounce en búsquedas/preview; cancelación de requests obsoletos.
- No decodificar simultáneamente varias previews completas.
- Medir startup, heap, commits React y scroll en 1360×768.
- Respetar hardware sin GPU dedicada; degradar preview, no bloquear edición.

## 11. Reglas de implementación HY4

1. Auditar qué existe antes de construir; reutilizar vistas y componentes reales.
2. No eliminar funciones para simplificar navegación.
3. No crear mock visual que se pueda confundir con integración terminada.
4. No modificar Rust, Tauri registry, schemas ni motor multimedia.
5. Consumir servicios a través de la fachada/contratos acordados.
6. Si falta endpoint, entregar especificación de contrato para SWE 2; la UI debe presentar “no disponible”.
7. Dividir archivos grandes por dominio sin romper imports existentes.
8. Probar viewport mínimo, test de componentes, typecheck y e2e visual.
9. Registrar capturas antes/después por pantalla.
10. No hacer commit/push ni alterar archivos no confirmados sin autorización.

## 12. Criterio visual final

No se acepta sólo porque compila. Debe poder completar desde UI:
- Crear proyecto y brief.
- Revisar plan/escenas.
- Añadir medios.
- Abrir editor y realizar una edición real.
- Acceder a audio, color, motion y captions.
- Revisar un run autónomo y su estado.
- Configurar proveedor/MCP con permisos y diagnóstico.
- Exportar y abrir la entrega.

Cada ruta se prueba en el escritorio Tauri real cuando dependa de APIs nativas, y no sólo en navegador.
## 13. Restricción nativa de ventana detectada en el Tauri config

La revisión del worktree el 2026-11-08 observó en apps/desktop/src-tauri/tauri.conf.json:
- ventana main inicial 900x580;
- minWidth 760 y minHeight 500;
- resizable=false;
- maximizable=false.

Esto contradice el objetivo de un editor de escritorio con paneles redimensionables. HY4 debe validar visualmente el problema y documentar el requerimiento; SWE 2 es owner de tauri.conf.json y debe habilitar resize/maximize y establecer dimensiones mínimas coherentes con la UI (target de prueba 1280x720, pantalla real de referencia 1360x768). La persistencia de tamaño/posición debe probarse en la app instalada. No fingir resize sólo con CSS.