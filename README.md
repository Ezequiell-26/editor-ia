# Editor IA

Editor de video local-first para Windows, con timeline multipista, asistencia de
IA opcional y exportación MP4 verificada. El proyecto, los medios y las claves se
quedan en tu equipo; la nube no es obligatoria.

## Qué existe hoy (verificado)

- **Aplicación de escritorio Tauri 2 + React + TypeScript estricto** con ventana
  nativa, comandos IPC allowlisted y diálogos de Windows. La UI tiene cinco
  vistas: Proyectos, Editor, Guion, Medios y Ajustes.
- **Proyectos portables** `.editoria.json` con esquema v1 versionado (Zod + JSON
  Schema + validación espejo en Rust), creación, apertura, guardado atómico,
  autoguardado y lista de recientes. **Guardar como** copia los medios
  referenciados a la nueva carpeta y rechaza sobrescribirlos. Un guardado fallido
  nunca se muestra como exitoso.
- **Importación de medios no destructiva**: el archivo se copia a `media/`, se
  mide con FFprobe, se hashea con SHA-256 y queda con licencia y procedencia
  declaradas por la persona. La biblioteca muestra miniaturas generadas con
  FFmpeg y permite montar clips o narrración.
- **Timeline multipista en frames**: pistas de video, imagen, audio, narración,
  subtítulos y gráficos; arrastrar, recortar, dividir, mover entre pistas
  compatibles, zoom, playhead y eliminación. Los solapamientos y las ventanas de
  origen se validan antes de aceptar cada edición.
- **Vista previa sincronizada** con video, imágenes, audio, transformaciones,
  opacidad y subtítulos; el render final se hace con FFmpeg y la vista previa se
  declara aproximada.
- **Subtítulos** con estilos, edición de tiempos y texto, generación desde el
  guion con tiempos estimados y quemado en el MP4 mediante libass.
- **Guion asistido por IA** con proveedores compatibles con la API de chat de
  OpenAI (OpenAI, Ollama, LM Studio, vLLM u otro endpoint equivalente) o un
  **proveedor simulado** que no hace red. El plan se valida antes de aplicarse,
  se puede editar escena por escena y queda registrado como operación en
  `provenance`. Las llamadas a proveedores pagos requieren confirmación de costo.
- **Narración local gratuita** con Windows SAPI: enumera voces instaladas,
  sintetiza a WAV y lo agrega al proyecto, sin enviar el texto a un servicio.
- **Render MP4 H.264/AAC real** desde Rust: composita video/imagen, mezcla audio,
  aplica fades y ganancia, quema subtítulos, reporta progreso y permite cancelar.
  Un render solo se marca `completado` después de que FFprobe verifica archivo,
  tamaño mínimo, duración y resolución.
- **Almacén de credenciales de Windows** (`keyring`/Credential Manager): la clave
  del proveedor no vive en el proyecto, en `localStorage` ni en los logs.- **Suite de pruebas**: esquema de proyecto, acciones de timeline, UI con jsdom,
  contrato del render-worker, crate Rust y un render real de humo con FFmpeg.
- **CI de verificación y empaquetado Windows** en `.github/workflows/`:
  instalador NSIS generado desde el commit exacto y subido solo si existe.

## Qué no existe todavía

- **Remotion** como renderizador: se deja fuera hasta validar su licencia para
  uso comercial automatizado.
- **Motor de clips gráficos**: el formato los admite, pero el renderer nativo
  rechaza un clip gráfico visible en vez de omitirlo en silencio.
- **Descarga de stock, investigación con fuentes, publicación en redes, clonación
  de voz y sincronización en la nube**. Nada de eso se simula.
- **Multiplataforma**: el objetivo verificado es Windows x64.
- **Render en paralelo**: hay un render por vez para no saturar la máquina.

## Evidencia de la última verificación (2026-10-19)

- `npm run verify`: **314 tests** Vitest en 20 archivos, typecheck estricto limpio.
- `cargo test -p editor-ia-desktop`: **55 passed + 1 ignored** (el render real se
  corre aparte) y `cargo fmt --all -- --check` limpio.
- Render real de humo (`EDITOR_IA_RUN_RENDER_TESTS=1`): 320×180 con video, audio y
  subtítulos quemados; salida verificada por FFprobe.
- Prueba manual en la app real (build de debug): proyecto abierto y autoguardado,
  importación múltiple de medios, timeline de 3 pistas, playback, guion simulado
  de 5 escenas aplicado con `provenance`, y export **1920×1080, 30 fps, 5.00 s,
  2.21 MB** (H.264/AAC) verificado por FFprobe; un frame extraído muestra el
  overlay y el subtítulo quemado.
- TTS local con Microsoft Sabina: WAV de 2.79 s, 22050 Hz, mono.
- **Guardar como** en otra carpeta: 4 medios copiados, proyecto reabierto
  y preview cargada desde la nueva raíz.
- Segundo export de 10 s con el flujo temporal → verificación → publicación:
  **4.45 MB**, H.264/AAC 1920×1080; el MP4 anterior quedó intacto.
- Instalador NSIS local: `Editor IA_0.1.0_x64-setup.exe`, 3.64 MiB.
- El estado de la primera ejecución de GitHub Actions se comprueba en el remoto;
  ningún workflow se declara verde por haber sido escrito.

## Requisitos medidos

- **Node.js `>= 22`** (`.nvmrc` fija 24; CI usa 22).
- **Rust stable** fijado por `rust-toolchain.toml`.
- **Windows con MSVC** que tenga `link.exe` **y** `lib/x64/msvcrt.lib`. Además,
  el build de Tauri necesita `rc.exe` del **Windows SDK** (no viene dentro de
  todos los toolchains MSVC). `scripts/rust-env.mjs` descubre ambos y exporta
  `LIB`, `INCLUDE` y `PATH`; corré `cargo` siempre con ese prefijo:

  ```bash
  node scripts/rust-env.mjs -- cargo check --workspace
  ```

- **FFmpeg y FFprobe** en `PATH` o elegidos desde Ajustes → Herramientas. Sin
  FFprobe no se importa material medido ni se verifica un render.
- **Windows PowerShell 5.1** con `System.Speech` para la narración local.
- WebView2, que Windows 10/11 ya incluye.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run verify` | typecheck estricto + suite Vitest completa. Puerta de cierre. |
| `npm run typecheck` | `tsc --noEmit` sobre los tres workspaces TypeScript. |
| `npm test` | suite Vitest: esquema, acciones, UI, worker y scripts. |
| `npm run build` | build de producción del frontend en `apps/desktop/dist`. |
| `npm run dev` | Vite en `:5173` (sin IPC nativo; para revisar la UI). |
| `npm run tauri:dev` | ventana Tauri real en modo desarrollo. |
| `npm run tauri:build` | binario y bundle NSIS de producción. |
| `npm run tauri:build:debug` | binario debug sin bundle, para probar la app. |
| `npm run schema:generate` | regenera el JSON Schema v1 desde Zod. |
| `npm run fixtures:write` | regenera los fixtures de prueba. |
| `powershell -File scripts/verify.ps1` | las mismas puertas que CI, incluido el build del binario. |
| `powershell -File scripts/package-windows.ps1` | verifica y construye el instalador NSIS local. |

El render real de humo (necesita FFmpeg/FFprobe):

```bash
EDITOR_IA_RUN_RENDER_TESTS=1 node scripts/rust-env.mjs -- \
  cargo test -p editor-ia-desktop render_live -- --ignored --nocapture
```

## Arquitectura

```text
apps/desktop/              React + Vite + Tauri 2
  src/                     UI, estado del proyecto, timeline, preview, IA
  src-tauri/               Rust: proyecto, medios, render, proveedores, TTS
apps/render-worker/        contrato JSON del worker y descubrimiento de capacidades
packages/project-schema/   formato canónico v1 (Zod, fixtures, JSON Schema)
docs/product/              especificación de producto
docs/architecture/         formato del proyecto
docs/automation/           loop de construcción y su ledger
scripts/                   verificación, empaquetado y entorno Rust/Windows
```

Decisiones centrales:

- **Rust es el único dueño del disco y de los procesos.** La UI invoca comandos
  tipados; nunca arma un comando de shell con texto de usuario o del modelo.
- **El proyecto es la fuente de verdad.** Los medios se referencian por ruta
  relativa al proyecto y se validan contra traversal, rutas absolutas y claves
  con forma de credencial.
- **La IA propone, el validador dispone.** El plan del modelo se parsea, se acota
  y se aplica como operación estructurada con revisión humana.
- **Nada se reporta como terminado sin verificación.** Un render `completed` exige
  un archivo real que pase el quality gate del perfil.

## Seguridad, licencias y datos

- Las claves del proveedor se guardan con el **Administrador de credenciales de
  Windows** y se leen sólo en el proceso Rust al hacer una llamada.
- El formato de proyecto rechaza campos con forma de credencial y no las acepta
  ni siquiera bajo el namespace `x-`.
- Cada asset declara `rights.license.commercialUse` y `rights.provenance`. Un
  material con licencia `unknown` no puede estar `ready` y el render se detiene
  si un clip lo usa.
- El TTS usa un script fijo de PowerShell; el texto viaja por `stdin`, nunca como
  parte de la línea de comandos.
- Los logs de render se sanean antes de mostrarse y no incluyen la carpeta del
  usuario.
- La licencia MIT cubre solo el código propio: no otorga derechos sobre medios de
  stock, fuentes, voces ni dependencias de terceros. Remotion no es una
  dependencia de esta versión.

Ver [SECURITY.md](SECURITY.md) para el detalle de la superficie y el reporte de
vulnerabilidades.

## Documentación

- [Especificación de producto](docs/product/PRODUCT-SPEC.md)
- [Formato de proyecto v1](docs/architecture/PROJECT-FORMAT.md)
- [Loop de construcción y ledger](docs/automation/BUILD-LOOP.md)
- [Seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE), sólo sobre el código fuente propio de Editor IA.
