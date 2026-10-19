# Editor IA — Especificación del producto y arquitectura

**Estado:** MVP implementado y verificado en Windows (2026-10-19). El detalle de lo
que existe, lo que falta y la evidencia de verificación está en el
[README](../../README.md). Las fases marcadas como “no incluidas” siguen fuera de
alcance.
**Repositorio:** https://github.com/Ezequiell-26/editor-ia  
**Objetivo inicial:** aplicación de escritorio para Windows, local-first y gratuita en su núcleo, que automatiza la producción de contenido para redes sociales y entrega proyectos editables, no solo vídeos finales.

## 1. Visión del producto

Editor IA debe funcionar como una pequeña productora audiovisual asistida por IA. El usuario conecta una API propia, elige un proveedor disponible, usa un modelo local o configura un endpoint compatible; describe lo que necesita y la aplicación prepara un plan de producción, guion, recursos, escenas, narración, subtítulos, montaje, gráficos animados, revisiones y exportaciones.

El resultado debe ser:
1. un vídeo renderizado listo para revisar y publicar;
2. un proyecto editable y versionado, con timeline, escenas, medios, voz, subtítulos, gráficos y transiciones;
3. un registro de fuentes, licencias, decisiones y verificaciones;
4. variantes por plataforma y relación de aspecto, reutilizando el mismo proyecto.

## 2. Principios de diseño

- **Free-first:** el núcleo no exige una suscripción de IA. El usuario paga solo por servicios externos que elija y cuya tarifa se muestre antes de usarlos.
- **Proveedor neutral:** el producto no depende de un único fabricante, API ni modelo.
- **Local-first:** los archivos fuente y los proyectos permanecen en el equipo salvo que el usuario elija un servicio remoto.
- **Editable y no destructivo:** las acciones de IA se representan como operaciones del proyecto y se pueden revisar, deshacer o rehacer.
- **Verificación explícita:** no se marca una escena ni un render como correcto hasta validar el resultado real.
- **Licencias y procedencia:** cada recurso externo debe registrar origen y condiciones de uso; no descargar ni redistribuir material de forma indiscriminada.
- **Seguridad:** las claves API se guardan fuera del frontend y nunca se introducen en prompts, registros, exports de proyecto ni logs de depuración.
- **Por etapas:** se prioriza un flujo vertical completo y útil antes de sumar pantallas desconectadas.
- **Rendimiento:** la vista previa debe ser ligera, limitar concurrencia y evitar cargar todos los medios en memoria.
- **Tolerancia a fallos:** las tareas largas tienen estados persistentes, cancelación, reintentos acotados y recuperación.

## 3. Público y casos principales

- Creadores de contenido que producen tutoriales de tecnología, reseñas y vídeos educativos.
- Usuarios que quieren adaptar una pieza a YouTube, Shorts, Reels y TikTok.
- Freelancers que necesitan generar entregables audiovisuales repetibles.
- Usuarios avanzados que conectan sus propias APIs, modelos locales, recursos y plantillas.

Flujo principal: idea/brief → investigación con fuentes → guion → storyboard → selección de medios → voz/transcripción → timeline → subtítulos/motion graphics → preview → validación → render/export → adaptación a otros formatos.

## 4. Alcance del MVP

### Incluido en el MVP

- Proyecto local con esquema versionado, creación, apertura, guardado automático y recuperación.
- Asistente de brief y guion editable, con notas de fuentes y afirmaciones por verificar.
- Biblioteca de medios para archivos locales y recursos descargados de fuentes admitidas, con metadatos y procedencia.
- Storyboard y timeline multipista básica: vídeo/imagen, audio, narración, subtítulos y capas gráficas.
- Modelo de proyecto que separa escenas, tiempo, recursos y efectos del motor de render.
- Configuración de proveedores: endpoints compatibles con OpenAI, claves propias y endpoints locales; catálogo de modelos editable.
- Almacenamiento de credenciales mediante almacén seguro del sistema operativo, si está disponible.
- Motor de tareas local con progreso, cancelación, reintentos acotados y logs saneados.
- Motor de renderizado por adaptadores. El primer motor debe cubrir un render/export comprobable; las plantillas de motion graphics deben poder sustituirse sin cambiar el esquema de proyecto.
- Subtítulos por transcripción importada o proveedor de transcripción configurable; motor local opcional.
- Plantillas para 16:9 y 9:16, intro/outro, títulos, subtítulos y gráficos reutilizables.
- Exportación MP4 con presets, comprobación de existencia/tamaño/duración y reporte de errores.
- Suite de pruebas, documentación de instalación, inventario de licencias y empaquetado para Windows.

### No incluido en el primer MVP

- Publicación automática en cuentas de redes sociales.
- Generación ilimitada de vídeo, audio o imágenes por modelos remotos sin informar costes.
- Clonación de voz sin consentimiento, scraping indiscriminado o descarga de contenido sin verificar derechos.
- Sustituir todas las funciones de DaVinci Resolve como NLE profesional.
- Agente con permiso irrestricto para ejecutar comandos, borrar material o publicar en nombre del usuario.

## 5. Arquitectura propuesta

Aplicación modular con contratos entre la UI, el núcleo local y los workers. Evitar múltiples servicios obligatorios y dependencias innecesarias.

- **Desktop UI:** Tauri 2 + React + TypeScript + Vite.
- **Backend de escritorio:** Rust para operaciones privilegiadas, gestión de proyectos/archivos, credenciales, permisos, IPC tipado, tareas y control de workers.
- **AI/provider layer:** adaptadores aislados por proveedor con una interfaz común para texto, herramientas, visión y futuras modalidades; las capacidades se declaran en vez de suponerse.
- **Production plan:** JSON tipado y versionado como única fuente de verdad del proyecto. Los modelos proponen cambios estructurados; el validador los verifica antes de aplicarlos.
- **Render workers:** procesos locales aislados invocados mediante argumentos permitidos y contratos JSON. No ejecutar comandos arbitrarios generados por el modelo.
- **Renderer adapters:** FFmpeg para las transformaciones y exportaciones multimedia que admita la configuración instalada; Remotion como adaptador opcional para composiciones React, sujeto a una comprobación explícita de licencia y coste. El núcleo no debe quedar bloqueado si uno no está instalado.
- **Transcription adapter:** proveedor remoto o motor local opcional, seleccionable por coste y rendimiento.
- **Asset providers:** conectores individuales de recursos con límites, atribución, licencia y estado de descarga.
- **Persistence:** archivos de proyecto versionados y una base local pequeña para índices, trabajos y preferencias; ninguna base de datos remota es obligatoria.
- **Quality gate:** render de prueba, comprobación de medios faltantes, rango de timecodes, relación de aspecto, audio, subtítulos y resultado final.

### Decisiones de seguridad

- Credenciales guardadas en el almacén seguro del SO; no en localStorage ni en archivos de proyecto.
- IPC con comandos allowlisted y tipos validados.
- Workers lanzados con ejecutables y argumentos permitidos; límites de tiempo, tamaño de salida y cancelación.
- No ejecutar texto libre del modelo como shell.
- Permisos específicos para red, archivos, descarga, procesos, API y publicación.
- Logs sin API keys, tokens ni datos privados.
- Operaciones destructivas requieren confirmación y respaldo reversible.

## 6. Estructura propuesta del repositorio

Este árbol es una propuesta de diseño, no una afirmación de que esos archivos ya existan. Las carpetas se crearán por etapas para no rellenar el repositorio con módulos vacíos sin contratos.

```text
editor-ia/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── .editorconfig
├── .gitignore
├── .gitattributes
├── package.json
├── package-lock.json
├── rust-toolchain.toml
├── Cargo.toml
├── docs/
│   ├── product/
│   │   ├── PRODUCT-SPEC.md
│   │   ├── MVP-ACCEPTANCE.md
│   │   └── ROADMAP.md
│   ├── architecture/
│   │   ├── OVERVIEW.md
│   │   ├── PROJECT-FORMAT.md
│   │   ├── RENDERING.md
│   │   ├── PROVIDERS-AND-KEYS.md
│   │   ├── SECURITY.md
│   │   └── decisions/
│   ├── development/
│   │   ├── WINDOWS-SETUP.md
│   │   ├── TESTING.md
│   │   └── RELEASE.md
│   └── licensing/
│       ├── THIRD-PARTY-NOTICES.md
│       └── ASSET-RIGHTS.md
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── routes/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── projects/
│   │   │   │   ├── brief/
│   │   │   │   ├── research/
│   │   │   │   ├── scripts/
│   │   │   │   ├── assets/
│   │   │   │   ├── storyboard/
│   │   │   │   ├── timeline/
│   │   │   │   ├── subtitles/
│   │   │   │   ├── audio/
│   │   │   │   ├── motion/
│   │   │   │   ├── preview/
│   │   │   │   ├── export/
│   │   │   │   ├── providers/
│   │   │   │   ├── agents/
│   │   │   │   └── settings/
│   │   │   ├── services/
│   │   │   ├── state/
│   │   │   └── styles/
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   ├── capabilities/
│   │   │   └── src/
│   │   │       ├── main.rs
│   │   │       ├── app/
│   │   │       ├── commands/
│   │   │       ├── projects/
│   │   │       ├── media/
│   │   │       ├── providers/
│   │   │       ├── credentials/
│   │   │       ├── jobs/
│   │   │       ├── render/
│   │   │       ├── persistence/
│   │   │       ├── security/
│   │   │       └── telemetry/
│   │   └── tests/
│   └── render-worker/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── protocol/
│           ├── renderers/
│           │   ├── ffmpeg/
│           │   └── remotion/
│           ├── compositions/
│           ├── scenes/
│           ├── components/
│           ├── transitions/
│           ├── captions/
│           ├── audio/
│           ├── templates/
│           ├── validation/
│           └── cli.ts
├── packages/
│   ├── project-schema/
│   ├── shared-contracts/
│   ├── timeline-core/
│   ├── media-utils/
│   ├── provider-contracts/
│   ├── prompt-templates/
│   ├── design-system/
│   └── test-fixtures/
├── resources/
│   ├── templates/
│   ├── fonts/
│   ├── sound/
│   ├── sample-projects/
│   └── licenses/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── render/
│   ├── e2e/
│   ├── fixtures/
│   └── security/
├── scripts/
│   ├── dev.ps1
│   ├── verify.ps1
│   ├── package-windows.ps1
│   └── audit-licenses.ps1
└── .github/
    └── workflows/
        ├── verify.yml
        └── windows-package.yml
```

## 7. Formato del proyecto

La representación interna debe ser versionada y engine-neutral:

- metadata: ID, nombre, versión del esquema, dimensiones, frame rate y color;
- assets: URI local relativa, hash, tipo, duración, dimensiones, licencia y procedencia;
- tracks: tipo y orden de capas;
- clips: asset, track, posición de inicio, in/out, velocidad, volumen y transformaciones;
- captions: texto, idioma y marcas temporales;
- scenes: intención narrativa, narración, medios, overlays y duración;
- motion: referencia de plantilla, props validadas y versión;
- audio: narración, música, ducking y niveles;
- render profiles: resolución, fps, codec, relación de aspecto y destino;
- provenance: recursos, fuentes, operaciones del agente y cambios aceptados;
- migrations: transformaciones entre versiones del esquema.

El proyecto no debe depender de un único motor de renderizado ni almacenar claves de proveedor.

## 8. Agentes y flujo de producción

Los roles iniciales serían componentes del mismo orquestador, no servicios independientes obligatorios:
1. Planner/Producer: convierte el brief en un plan de escenas.
2. Researcher: consulta fuentes y registra evidencias.
3. Scriptwriter: genera narración editable con fuentes y tiempos estimados.
4. Asset scout: recomienda medios y licencia; nunca publica ni descarga sin aplicar las políticas configuradas.
5. Editor: propone operaciones estructuradas en la timeline.
6. Motion designer: selecciona plantillas y parámetros.
7. Audio/subtitle specialist: alinea narración, captions y niveles.
8. QA reviewer: comprueba inconsistencias, tiempos, recursos y render.
9. Coordinator: distribuye las subtareas con límites de coste, llamadas, tiempo y reintentos.

Todos los cambios generados por IA pasan por un plan estructurado, validación y revisión antes de tocar el proyecto. La paralelización se usa solo en tareas independientes.

## 9. Modelo de costes

- Cero coste obligatorio de cuenta de IA: las tareas locales y los conectores de terceros se ofrecen según disponibilidad.
- Mostrar proveedor, modelo, coste estimado, límites y modo local/remoto antes de trabajos que consuman cuota.
- El usuario puede deshabilitar proveedores pagos completamente.
- Las integraciones de render, transcripción, TTS, fuentes y recursos llevan sus propias comprobaciones de licencia.
- Remotion no es dependencia obligatoria de la primera versión. La licencia oficial diferencia el uso creativo de herramientas automatizadas para crear vídeos; validar los términos vigentes antes de distribuir o vender la app.

## 10. Criterios de aceptación del primer vertical slice

El MVP no se considerará listo hasta que las pruebas demuestren todo lo siguiente:

1. Una instalación limpia de Windows abre la aplicación.
2. El usuario crea, guarda, cierra y vuelve a abrir un proyecto sin perder estado.
3. Un proveedor simulado y un proveedor configurado permiten generar un guion sin exponer secretos.
4. Se pueden importar medios locales y registrar recursos externos con procedencia.
5. El guion se convierte en escenas y una timeline editable.
6. Se generan subtítulos de ejemplo con timecodes validados.
7. Un proyecto de prueba produce un MP4 real mediante un renderer disponible.
8. El renderer falla con mensaje claro si faltan binarios o archivos; no deja trabajos falsamente completados.
9. La aplicación permite cancelar una tarea y recuperar el estado después de reiniciar.
10. Los tests comprueban que ningún secreto aparece en logs o archivos exportados.
11. Se registra y revisa la licencia de cada dependencia empaquetada y recurso redistribuido.
12. El instalador, una prueba E2E básica y el artefacto de Windows pasan en CI.

## 11. Plan de entrega propuesto

- **Fase 0 — Especificación:** aprobar visión, límites, contratos y árbol.
- **Fase 1 — Scaffold y CI:** estructura real mínima, build reproducible, lint, tipos, pruebas y empaquetado Windows.
- **Fase 2 — Proyecto y medios:** almacenamiento, importación, esquema versionado y biblioteca de recursos.
- **Fase 3 — Vertical slice de guion a vídeo:** brief → escenas → timeline sencilla → render real → export.
- **Fase 4 — IA y proveedores:** claves seguras, conectores, presupuestos, agentes y tareas recuperables.
- **Fase 5 — Editor y calidad:** captions, audio, motion, preview y QA.
- **Fase 6 — Preparación pública:** accesibilidad, rendimiento, licencias, seguridad, instalador y documentación.

Cada fase tiene pruebas y un estado verificado/unverified explícito. No se marca una capacidad como completada solo por crear los archivos de su carpeta.

## 12. Riesgos y decisiones abiertas

- La automatización audiovisual consume CPU, RAM, disco y cuotas; limitar concurrencia y proporcionar estimaciones.
- La licencia de Remotion para una app de generación automática debe validarse antes de adoptarla como ruta comercial obligatoria.
- Las APIs gratuitas cambian límites y disponibilidad; no prometer permanencia.
- Las licencias de material de stock, música, fuentes y assets deben validarse individualmente.
- Los proveedores no soportan todos las mismas capacidades; exponer una matriz de capacidades y fallbacks explícitos.
- Se prefiere Windows primero, con interfaces abstractas que no bloqueen futuros sistemas operativos.
- No se debe desarrollar el árbol entero como carpetas vacías: cada módulo se crea cuando existe su contrato, implementación mínima y prueba correspondiente.
