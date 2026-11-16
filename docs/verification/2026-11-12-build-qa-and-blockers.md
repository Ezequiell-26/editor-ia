# Olyvia — verificación de build, QA y bloqueos

**Fecha:** 2026-11-12  
**Proyecto:** `D:\Users\ofici\QODER-WORK\editor-ia-architecture`  
**Rama:** `architecture/refactor-foundation`  
**HEAD observado:** `c6a23a8`  
**Estado:** QA visual y paleta dinámica validados; guardado de proyectos reforzado; tests Rust nativos pendientes.

## 1. Integridad del trabajo y Git

- La rama local está sincronizada con `origin/architecture/refactor-foundation`: 0 commits por delante y 0 por detrás.
- El árbol de trabajo ya tenía 615 rutas con cambios, renombres, eliminaciones o archivos sin seguimiento; al cierre presenta 631 rutas con cambios, contando este bloque y las referencias visuales.
- Devin estaba activo y había un servidor Vite previo en el puerto 3000.
- Se preservaron todos esos cambios. No se hizo reset, clean, checkout, commit ni push.
- Esta continuación modificó `apps/desktop/src-tauri/src/projects/storage.rs`, `storage.tests.rs`, `apps/desktop/src/styles/capcut-ui.css`, 13 snapshots visuales y este informe.
- Backups: `memory/backups/storage.rs.pre-max-write-20261112`, `memory/backups/css-audit-snapshots-pre-redesign-20261112/`, `memory/backups/capcut-ui.css.pre-palette-cascade-fix-20261112`, `memory/backups/capcut-ui.css.pre-dynamic-accents-20261112` y `memory/backups/Laboratorio-chrome-win32.pre-palette-cascade-20261112.png`.

**Motivo de la contención:** con cientos de rutas compartidas y un agente de desarrollo activo no era seguro aplicar otro rediseño amplio encima del mismo árbol. Este informe se creó en una ruta nueva.

## 2. Verificaciones aprobadas

| Verificación | Resultado |
|---|---|
| TypeScript de la app desktop (`npm run typecheck` en `apps/desktop`) | **PASS** |
| Pruebas Vitest seleccionadas | **PASS — 9 archivos en dos bloques, 100 tests** |
| Inventario de tests Rust ignorados | **PASS — 73; baseline 73** |
| Build web de producción (`npm run build`) | **PASS — 561 módulos transformados** |
| Servidor de desarrollo local | **PASS — HTTP 200; HTML contiene el root React** |
| E2E visual (`css-audit.spec.ts`) | **PASS — 13/13; cero diferencias y sin actualizar snapshots en la ejecución final** |
| E2E de Ajustes, paleta y perspectiva | **PASS — 9/9** |
| E2E shell/navegación (`app.spec.ts`) | **PASS — 4/4** |
| Sincronización Git con upstream | **PASS — 0 ahead / 0 behind** |

Pruebas Vitest ejecutadas:
- `Inspector.tab-request.test.tsx`
- `Timeline.test.tsx`
- `EditorAssets.test.tsx`
- `mask-presets.test.ts`
- `face-mask.test.ts`
- `AppearanceCard.test.tsx`
- `ColorStudioCard.test.tsx`
- `appearance.test.ts`
- `ColorWheel.test.tsx`

Los cinco primeros archivos aportaron 63 tests; los cuatro últimos, 37 tests de Apariencia y paleta.

El inventario confirma que no aumentó la cantidad de tests Rust marcados `#[ignore]`; no significa que los tests Rust se hayan ejecutado.

## 3. Verificaciones incompletas o fallidas

### Rust — tracking

Se intentó ejecutar:

```powershell
$env:CARGO_BUILD_JOBS='1'
node scripts/rust-env.mjs -- cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib object_track
```

La compilación de dependencias de Windows consumió hasta aproximadamente 2,4 GB en `rustc`; la memoria libre llegó a 0,92 GB. Se interrumpió la compilación para proteger el PC y no interferir con Devin.

- **Resultado:** NO EJECUTADO; sin veredicto sobre el código del tracker.
- No debe registrarse como fallo de los tests ni como regresión de código.
- Los tests existentes de `object_track` cubren rectángulo inválido, NCC, movimiento/crecimiento sintético, recuperación tras salto, rotación y dimensiones escaladas.
- La caché temporal de compilación quedó en `.target-architecture` y `.cargo-home-architecture`. No borrarla automáticamente.

### Auditoría de seguridad

- `npm audit --omit=dev`: 0 críticas, 1 alta atribuida a Zod.
- `cargo audit`: omitido, la herramienta no está instalada.
- El script de auditoría devuelve código 0 porque su umbral de bloqueo actual son las vulnerabilidades críticas; por tanto, **no significa auditoría sin hallazgos**.
- npm recomienda una actualización mayor a Zod 4. No realizarla sin análisis de compatibilidad.

Hay una discrepancia pública sobre la alerta `GHSA-mrhx-c7xc-m3w5`: GitHub la lista como alta, mientras que el registro CVE correspondiente fue rechazado por considerar que el consumo escala con el JSON ya parseado y que el límite de tamaño de entrada es la defensa pertinente. Debe mantenerse como hallazgo por verificar, no como vulnerabilidad explotable confirmada.

Defensa ya comprobada:
- `apps/desktop/src-tauri/src/projects/storage.rs` limita el documento local a **8 MiB antes de leerlo**.
- `apps/desktop/src-tauri/src/projects/tests.rs` comprueba el rechazo de un archivo de 9 MB.
- El importador de timelines tiene un límite separado de **32 MB** y límites de clips/medios.
- Siguen pendientes límites de dominio coherentes para datos entrantes por IPC/MCP y otras rutas que no usan el lector de proyecto. Revisar primero los contratos y consumidores para no romper proyectos válidos.

Referencias:
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://www.cve.org/CVERecord?id=CVE-2023-54404

### Guardado de proyectos — límite simétrico

Se corrigió `storage::write_project_file`: ahora rechaza contenido superior a `MAX_PROJECT_FILE_BYTES` (8 MiB) antes de crear el archivo temporal. Así ya no puede guardarse localmente un proyecto que el lector de la misma app rechazará al reabrir.

Se añadieron `storage.tests.rs` con dos pruebas:
- 8 MiB + 1 byte: `FileTooLarge`, conserva el archivo anterior y no deja temporales.
- 8 MiB exactos: escritura aceptada y lectura posterior correcta.

`rustfmt --check` y `git diff --check` pasaron para ambos archivos propios. Las pruebas Rust **todavía no se ejecutaron**, porque compilar el crate de escritorio llegó a consumir ~2,4 GB en `rustc` y la memoria libre bajó a 0,92 GB. La compilación anterior terminó sin veredicto de tests.

### Tema y paleta: los estilos CapCut anulaban los ajustes del usuario

Se detectó que `capcut-ui.css` definía la paleta con `!important`, por encima de los tokens inline que publica `applyAppearance`. El selector de color actualizaba React y `aria-valuetext`, pero el acento CSS seguía fijo en `#00c1cd`.

Corrección aplicada:
- La paleta CapCut define fallbacks iniciales, sin `!important`, para dejar prevalecer los tokens activos.
- Exportar, botones principales, foco, estados activos de navegación/Inspector, selección y trim handles usan `--color-accent`, `--color-accent-light`, `--color-accent-ink` y `--color-cta`.
- Se comprobó con Playwright que el valor del control y `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` cambian juntos desde `#3df4ba` hasta `#3df2f4`.
- E2E de Ajustes, paleta y perspectiva: 9/9; E2E visual de 13 vistas: 13/13 con `maxDiffPixelRatio: 0`; los tests de Apariencia/ColorWheel/ColorStudio: 37/37.
- Se actualizaron las referencias visuales del rediseño y la captura de Laboratorio después de confirmar que ahora refleja la paleta guardada. Cada juego de referencias previo quedó respaldado.

`capcut-ui.css` conserva `#00c1cd` sólo como fallback por defecto; no quedan colores turquesa fijos en los estados interactivos principales.

### Calidad del diff

`git diff --check` global sigue señalando líneas vacías sobrantes al final de cuatro archivos Rust, una línea con espacios finales en `docs/IMPROVEMENT-QUEUE.md` y una línea vacía sobrante al final de `docs/olyvia-blueprint/11_FRONTEND_BACKEND_HANDOFF.md`.

No se corrigieron: pertenecen al conjunto de trabajo concurrente y primero deben revisarse con su autor para no alterar cambios en curso.

## 4. Hallazgos del build web

El build de producción completó, pero informó:

1. `lottie-web/build/player/lottie.js` contiene `eval`; Vite advierte por el riesgo y por la minificación.
2. `src/platform/tauri/window.ts` se importa dinámicamente desde `dual-monitor.ts` y estáticamente desde varias vistas; la importación dinámica no crea un chunk separado.
3. Chunk principal: aproximadamente **875 KB minificado / 266,5 KB gzip**.
4. Chunks grandes: Emojibase ~499 KB, React ~413 KB, Inspector ~329 KB y Lottie ~308 KB.
5. Fuentes incluidas: Noto Color Emoji ~7,25 MB y Twemoji ~1,47 MB.
6. CSS principal ~672,48 KB sin comprimir.

Prioridades de optimización:
- Medir qué vistas cargan realmente cada paquete y separar dependencias por ruta, sin duplicar vendors ni alterar el orden de inicialización.
- Revisar la carga de fuentes emoji y evitar que vistas que no las usan las descarguen.
- Resolver importaciones duplicadas de `window.ts` con un contrato de carga uniforme.
- Aislar el uso de Lottie y evaluar una alternativa o configuración sin `eval`, tras comprobar compatibilidad con las animaciones existentes.
- Añadir presupuestos de bundle medidos por ruta; no elevar el umbral para silenciar avisos.

## 5. Estado funcional conocido y próximos pasos

### Tracking

El tracker actual usa template matching/NCC y una región semilla seleccionada por el usuario. Tiene búsqueda local y re-adquisición global cuando cae la confianza, pero **no es detección automática por clase** (por ejemplo, identificar “persona”, “auto” o “perro” sin selección). Tampoco garantiza seguimiento tras oclusión larga o cambio fuerte de apariencia.

Siguiente evolución:
1. Ejecutar los tests Rust en CI Windows o en una máquina con más memoria.
2. Comparar muestras contra clips reales: movimiento, escala, rotación, oclusión y movimiento de cámara.
3. Introducir un backend de detección/segmentación opcional y desacoplado, con fallback al tracker ligero actual.
4. Mantener una opción local ligera y evitar forzar modelos grandes en PCs con GPU integrada.
5. Comprobar que máscaras, blur y encuadre siguen al objetivo correctamente tanto en preview como en export.

### UI y paridad con AlaukCut/CapCut

La auditoría detectó diferencias en las 13 vistas porque los snapshots correspondían al diseño anterior. Se respaldaron las referencias antiguas y se regeneraron los 13 snapshots con el rediseño revisado. Después se corrigió el cascade de la paleta dinámica y se actualizó únicamente Laboratorio tras respaldar esa captura. La suite volvió a pasar 13/13 sin `--update-snapshots` y con `maxDiffPixelRatio: 0`. Backups: `memory/backups/css-audit-snapshots-pre-redesign-20261112/` y `memory/backups/Laboratorio-chrome-win32.pre-palette-cascade-20261112.png`.

Siguiente evolución:
1. La revisión visual de las 13 vistas a 1280×720 está completada y el baseline nuevo pasa sin tolerancia de píxeles.
2. Comprobar 1360×768, 1280×720 y ventanas de tamaño mínimo en la app nativa.
3. Abrir un proyecto real con audio, vídeo e imagen; verificar inspector, preview, timeline, undo/redo y guardado.
4. Probar una exportación real y verificar audio, duración, resolución y reproducción final.
5. Mantener los snapshots bloqueados a cero diferencias y actualizarlos sólo ante cambios visuales revisados.

### Funciones y calidad de producto

- Completar tracking automático por detección/segmentación sin exigir selección inicial, como capacidad separada y opcional.
- Revisar máscaras personalizadas, feather, blur, stickers, Motion Graphics y plantillas con clips reales.
- Validar importación/exportación y codecs, HDR/4K, compresión, sincronía, audio y subtítulos; no declarar equivalencia de preview y export cuando un filtro sea aproximado.
- Comprobar todos los controles visibles: ningún botón, menú o panel debe ser decorativo o quedar sin acción.
- Auditar las rutas MCP/IPC, límites de entrada, permisos de archivos y procesos externos; nunca confiar sólo en validación del frontend.
- Confirmar que la IA propone operaciones reproducibles sobre la timeline, con preview, confirmación y undo, y que no cambia el proyecto destructivamente sin autorización.

## 6. Orden recomendado de trabajo

| Prioridad | Trabajo | Criterio de cierre |
|---|---|---|
| P0 | Mantener intacto el árbol concurrente y obtener un build/test nativo reproducible | Sin pérdida de cambios; CI Windows verde |
| P1 | QA E2E con proyecto y medios reales | Importar, editar, reproducir, guardar, reabrir y exportar |
| P1 | Cerrar el gap de tracking automático | Detección/seguimiento real, confianza y recuperación probadas |
| P1 | Límites de entrada IPC/MCP | Tamaño, cantidad, profundidad y timeout con tests negativos |
| P1 | Resolver hallazgos del bundle | Chunks por ruta y carga de fuentes medida |
| P1 | Revisión visual de 13 vistas | Snapshots comparados manualmente, sin aprobar regresiones |
| P2 | Catálogos, efectos y plantillas | Conteo y paridad declarados sólo después de probar cada ruta |
| P2 | Preparación de distribución/ofuscación | Revisión de secretos, símbolos, licencias, binarios y actualizador |

## 7. Cierre y acciones de esta continuación

- Se aprobaron TypeScript, 100 tests Vitest focalizados, inventario de tests ignorados, build web, HTTP local, E2E visual 13/13, E2E de Apariencia/paleta/perspectiva 9/9 y E2E de shell/navegación 4/4.
- Se restauró la prioridad de la paleta de usuario en CSS y se propagó a los controles principales del editor; los fallos de Apariencia en vivo ya no se reproducen.
- Se aplicó el límite simétrico de 8 MiB al guardado de proyectos y se añadieron dos pruebas Rust; el código pasa `rustfmt`, pero las pruebas Rust siguen pendientes de CI Windows o equipo con más memoria.
- No se ejecutó `cargo audit`.
- Se actualizaron las referencias visuales del rediseño y el snapshot afectado por el cambio de paleta; todos los 13 pasan en la última ejecución normal y se conservaron las versiones previas en backup.
- No se hizo commit ni push. La rama sigue sincronizada con upstream; los 631 paths de trabajo se preservaron.
- Próximo bloque: QA nativo con un proyecto y medios reales, export y audio; después cerrar tracking automático, límites IPC/MCP y optimización del bundle.
