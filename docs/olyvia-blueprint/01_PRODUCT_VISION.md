# 01 — Visión y requisitos de producto

## 1. Qué es Olyvia

Olyvia es un estudio creativo de escritorio con IA que puede **crear y editar vídeos completos** a partir de una idea, un brief, archivos aportados por el usuario o un proyecto existente. Debe funcionar como una productora audiovisual asistida: interpretar el objetivo, proponer una solución, obtener o generar recursos autorizados, montar una edición coherente, revisar el resultado y entregar un archivo final junto con un proyecto editable.

No es solamente un chat conectado a FFmpeg ni un conjunto de herramientas sueltas. El valor está en unir planificación creativa, operaciones de edición verificables, herramientas profesionales y entrega final.

## 2. Propuesta de valor

- Convertir instrucciones naturales en proyectos audiovisuales reales.
- Reducir el trabajo repetitivo de edición sin quitar control creativo.
- Permitir producción multimodal: vídeo, imágenes, voz, música, efectos de sonido, gráficos, subtítulos, personajes y animaciones.
- Reutilizar un proyecto para diferentes formatos y plataformas.
- Mantener los medios del usuario localmente salvo consentimiento explícito para servicios remotos.
- Permitir elegir proveedores, modelos y presupuesto.
- Entregar MP4 verificable, proyecto editable, medios usados, licencias y manifiesto.

## 3. Usuarios y modos

| Usuario | Necesidad | Experiencia prioritaria |
|---|---|---|
| Principiante/creador | Crear un vídeo sin conocer una NLE | Brief guiado, preview, aprobación y entrega. |
| Creador frecuente | Producir series, shorts y variantes | Plantillas, proyectos reutilizables, lotes y presets. |
| Editor profesional | Controlar montaje, color, audio y motion | Editor manual, timeline multipista y controles precisos. |
| Profesional asistido por IA | Acelerar tareas complejas con revisión humana | Copiloto que propone operaciones, explica cambios y permite deshacer. |

Dos modos, un solo proyecto:
1. **Estudio IA:** flujo guiado y autónomo con aprobación por etapas configurable.
2. **Editor:** control manual sobre el proyecto, sin perder las ventajas de IA.

No crear dos productos, dos formatos de proyecto ni dos motores de edición separados.

## 4. Entradas admitidas

- Instrucción textual o brief estructurado.
- Vídeos, fotos, ilustraciones, audios, música, locuciones y subtítulos del usuario.
- Carpetas de recursos y proyectos existentes.
- Grabación de pantalla o cámara cuando el usuario la inicia.
- URLs y fuentes externas únicamente mediante conectores autorizados y dentro de sus términos.
- Referencias visuales: capturas de estilo, ejemplos, identidad de marca y recursos propios.
- Guion, storyboard, notas, documentos y material de investigación.

Al importar, detectar tipo real con probing, tamaño, duración, dimensiones, fps, canales, codec, orientación, transparencia, sample rate y hash. No confiar sólo en extensión.

## 5. Resultados entregables

- Vídeo final en el perfil seleccionado, con audio y sincronización validados.
- Archivo de proyecto editable, versionado y portable.
- Timeline con escenas, clips, pistas, transiciones, keyframes, títulos, gráficos y efectos.
- Subtítulos SRT/VTT/ASS según el flujo y el render.
- Recursos usados y su procedencia.
- Registro de atribución, licencias y restricciones cuando aplique.
- Manifiesto de exportación con parámetros, duración, resolución, fps, codecs, loudness y hashes.
- Variantes 16:9, 9:16, 1:1 y demás relaciones soportadas, conservando safe areas y composición.
- Informe de calidad, advertencias y tareas que requieren aprobación.

## 6. Flujos de producto principales

### A. Crear desde una idea
1. El usuario escribe qué vídeo necesita, audiencia, duración aproximada, tono, idioma, canal y objetivo.
2. Olyvia identifica ambigüedades importantes y pide sólo lo indispensable.
3. El sistema produce un plan con guion, escenas, duración por escena, recursos requeridos, audio, gráficos y presupuesto estimado.
4. El usuario revisa o aprueba el plan.
5. Se obtienen/generan los medios autorizados y se verifica cada archivo.
6. Se ensamblan escenas en el proyecto editable.
7. Se revisa la edición, el audio, los subtítulos y la continuidad.
8. Se exporta, se inspecciona el MP4 real y se corrige un número acotado de problemas.
9. Se entrega el vídeo y el proyecto, con fuentes y reporte.

### B. Editar material existente
1. Importar carpeta/proyecto y analizar los medios.
2. Resumir escenas, silencios, hablantes, encuadres, ritmo, audio y problemas.
3. El usuario solicita una edición o una intención (tutorial ágil, documental, anuncio).
4. Olyvia genera un plan de operaciones y vista previa.
5. Aplicar cambios no destructivos y revisables.
6. Revisar el resultado y renderizar.

### C. Historia con imágenes y voz
1. Leer el guion y analizar la locución.
2. Dividir por beats narrativos y timecodes.
3. Crear storyboard con un prompt de imagen individual por escena.
4. Asociar cada imagen con el fragmento exacto de voz.
5. Aplicar movimiento de cámara, parallax, capas, gráficos o clips generados cuando estén disponibles.
6. Asegurar continuidad visual de personajes y estilo.
7. Renderizar con narración, música, SFX y subtítulos sincronizados.

### D. Tutorial o vídeo educativo
- Respetar la información que no debe exponerse.
- Detectar pantallas, pasos, ventanas y elementos importantes.
- Agregar zooms, resaltados, callouts, cursor, capítulos y subtítulos.
- Evitar cubrir el contenido principal.
- Revisar privacidad antes de exportar.

### E. Shorts y variantes
- Detectar momentos relevantes y estructura de retención.
- Reencuadrar con seguimiento de sujeto cuando haya soporte real.
- Generar varias versiones comparables.
- Conservar subtítulos, márgenes seguros, voz inteligible y ritmo.
- Nunca inventar métricas de rendimiento.

### F. Memes, stickman y motion graphics
- Utilizar assets propios, plantillas y generadores permitidos.
- Animar personajes, texto, stickers, formas, partículas y efectos mediante timeline.
- Sincronizar la animación con voz/música.
- Mantener los gráficos editables; no aplanarlos si el usuario requiere retoques.

## 7. Requisitos funcionales transversales

- Todo cambio de IA debe traducirse a operaciones de proyecto tipadas.
- Vista previa antes de acciones costosas o destructivas.
- Undo/redo, historial y checkpoints.
- Guardado automático, recuperación y copia de seguridad.
- Cancelación verdadera de tareas.
- Estado persistente de cada trabajo.
- Costos estimados y consentimiento antes de llamadas facturables.
- Proveedores configurables sin dependencia de una única empresa.
- El usuario puede pausar, editar el plan y reanudar.
- La ejecución no debe depender de que un componente React siga montado.
- Toda afirmación de “generado”, “descargado”, “exportado” o “verificado” requiere evidencia del artefacto real.

## 8. Calidad creativa

La calidad no se mide sólo por resolución o ausencia de errores técnicos. Incluir evaluación de:
- Correspondencia con el brief y guion.
- Ritmo, continuidad, variedad visual y duración.
- Sincronización de voz, música, SFX y subtítulos.
- Legibilidad de títulos y captions.
- Consistencia de estilo y personajes.
- Niveles de audio y ausencia de clipping.
- Composición, safe areas y recortes.
- Integridad de los medios y ausencia de frames negros inesperados.
- Derechos y procedencia de assets.

Las evaluaciones subjetivas deben producir advertencias y evidencia, no una falsa puntuación objetiva universal. El usuario conserva la decisión final.

## 9. No objetivos / límites

- No sustituir inmediatamente todos los aspectos de DaVinci Resolve.
- No descargar ni reutilizar material protegido sin permiso.
- No ofrecer generación remota ilimitada sin costo estimado.
- No ejecutar shell libre generado por el modelo.
- No prometer procesamiento en segundo plano después de cerrar la aplicación si no existe un servicio del sistema instalado y operativo.
- No prometer que cualquier proveedor o modelo puede editar vídeo: declarar capacidades reales.
- No dar por hecho que una licencia del repositorio también cubre modelos, datos, codecs, plugins, fuentes o contenido descargado.