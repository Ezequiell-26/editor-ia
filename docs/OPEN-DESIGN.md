# Open Design dentro de Olyvia

Integración de la biblioteca portable de [Open Design](https://github.com/nexu-io/open-design)
(Apache-2.0) en la superficie **Creador → Diseño**. Todo el contenido se sirve
desde `apps/desktop/public/open-design/`, funciona sin conexión y no agrega
dependencias de runtime.

## Qué incluye

| Bloque | Cantidad | Contenido |
| --- | --- | --- |
| Sistemas de diseño | 152 | `manifest.json`, `DESIGN.md`, `tokens.css`, `design-tokens.json`, `tailwind-v4.css`, `components.html`, previews y guía de uso |
| Craft | 11 | Reglas universales de color, tipografía, accesibilidad, estados, animación, RTL, formularios, leyes de UX y anti-AI-slop |
| Plantillas de prompt | 104 | Imagen y video, con modelo, aspecto, autor, licencia y prompt completo |
| Plantillas de diseño | 99 | Recetas `SKILL.md` con ejemplo HTML, licencia, plataforma, escenario y etiquetas; 16 excluidas por licencia no verificable, 23 previews offline seguras |
| Skills | 57 | `SKILL.md` con licencia verificable; 37 son recetas de diseño y 20 de utilidad quedan como referencia; 112 excluidas, 3 previews seguras |
| Catálogo | 1 | `catalog.json` generado: metadatos, paletas resueltas a color sólido, fuentes, craft sugerido, recetas y rutas |
| Avisos | 2 | `LICENSE` (Apache-2.0) y `NOTICE.md` con la atribución y las licencias de cada prompt |

Los archivos originales no se modifican. El generador sólo agrega el índice y los
avisos. Se excluyeron dos plantillas de prompt cuya fuente no declaraba una
licencia reutilizable.

## Experiencia

- **Sistemas**: búsqueda por marca, categoría o estilo; filtros por categoría
  traducidos al español; paleta real del paquete; guía `DESIGN.md` renderizada
  sin HTML crudo; previews y componentes aislados en `iframe` con sandbox.
- **Usar en miniaturas**: aplica el acento sólido del sistema al creador de
  miniaturas, guarda la selección en `editoria.design-system.v1` y anuncia el
  cambio con `olyvia:design-applied`. El canvas y el PNG exportado usan el
  mismo acento; el nombre del sistema queda visible junto a la paleta.
- **Motion**: la misma selección aparece en el formulario de gráficos; «Aplicar»
  escribe el fondo, el acento y el color de texto en los campos reales de la
  plantilla (incluye `glitchB` con `accent-on`). El render no cambia.
- **Craft**: lectura completa de cada regla y copia al portapapeles para usarla
  como contexto del asistente.
- **Prompts**: filtro imagen/video, metadatos y licencia visibles, prompt
  completo con copia y enlace a la fuente original.
- **Navegación**: `?view=design`, paleta de comandos y el rail («Más
  herramientas») llegan a la pestaña Diseño del hub Creador.
- **Generador brief → HTML**: con el sistema activo, un brief de 20 a 4 000
  caracteres y hasta dos reglas de craft, el proveedor de Ajustes → IA devuelve
  un documento autocontenido. Cinco formatos (página, dashboard, deck, tarjeta
  y miniatura), preview en `iframe sandbox=""`, copia y guardado nativo. El
  comando Rust rechaza scripts, iframes, recursos externos y atributos `on*`;
  el HTML se acota a 160 000 caracteres. [Formulario](screenshots/olyvia-design-generator-2026-10-29.png)
  y [diseño real](screenshots/olyvia-design-generated-2026-10-29.png).
- **Plantillas como recetas**: 99 `SKILL.md` con licencia verificable; «Usar en
  generador» elige Deck para las de tipo deck, Tarjeta para imagen y Página para
  el resto, y envía la receta completa como contexto. Las previews sólo se
  abren cuando el ejemplo no tiene scripts ni URLs remotas; las demás muestran
  el aviso y conservan el código fuente. [Catálogo](screenshots/olyvia-design-templates-2026-10-29.png)
  y [receta activa](screenshots/olyvia-design-template-generator-2026-10-29.png).
- **Skills**: 57 fichas con licencia, modo y fuente. Las de diseño se ofrecen como
  receta; las 20 de utilidad se leen y copian pero no se envían al generador.
  La detección de previews revisa todos los HTML del paquete. [Skills](screenshots/olyvia-design-skills-2026-10-29.png)
  y [skill activa](screenshots/olyvia-design-skill-generator-2026-10-29.png).
- **PNG real**: el HTML seguro se monta en un iframe aislado y se rasteriza con
  html2canvas 1.4.1 (MIT) en el WebView2; no se abre Chrome. El generador pide
  flexbox para que el rasterizador sea fiel. [PNG real](screenshots/olyvia-design-generated-png-2026-10-29.png).
- **MP4 real**: WebCodecs codifica VP9 y mp4-muxer 5.2.1 (MIT) produce un MP4
  de 3 s a 15 fps; las animaciones CSS se avanzan frame a frame y un zoom leve
  mueve los diseños estáticos. Sin Chrome ni GSAP. [MP4](screenshots/olyvia-design-video-2026-10-29.mp4)
  y [frame](screenshots/olyvia-design-video-frame-2026-10-29.png).
- **Decks a PDF y video**: el formato Deck pide 3–6 secciones `<section data-slide>`
  de 1280×720; html2canvas + jsPDF 2.5.2 (MIT) arman una página por sección.
  Prueba real: **4 páginas, 107.152 bytes**, 4 objetos `/Type /Page`, sin Chrome.
  [PDF](screenshots/olyvia-design-deck-2026-10-29.pdf). El MP4 recorre las 4
  secciones como escenas con deslizamiento lateral: **2 s / 10 fps / 156.680 bytes**
  ([video](screenshots/olyvia-design-deck-video-2026-10-29.mp4)). El PNG sigue
  capturando la primera diapositiva; PDF y MP4 contienen todas. Se hereda el
  fondo del `body` para no dejar texto claro sobre blanco.
- **A Medios y timeline**: con un proyecto abierto, el PNG o MP4 se escribe en
  `<proyecto>/media` y se importa como asset listo. «Montar en la timeline» usa
  `addClipFromAsset` en el playhead, crea la pista compatible y abre el editor.
  Verificado con un test Rust real (proyecto temporal + FFprobe): PNG 1×1
  importado como `image`, ruta relativa `media/diseno-….png`.

## Reproducir la importación

El repositorio de Open Design pesa ~3,6 GB y tiene 16 677 archivos; no se clona
entero. Se usó un checkout disperso:

```bash
git clone --filter=blob:none --no-checkout --depth 1 \
  https://github.com/nexu-io/open-design.git D:/DevCache/open-design
cd D:/DevCache/open-design
git sparse-checkout init --cone
git sparse-checkout set design-systems craft prompt-templates design-templates skills
git checkout main
cd <repo Olyvia>
npm run sync:open-design -- --source D:/DevCache/open-design
```

El script `scripts/sync-open-design.mjs` valida las rutas, copia sólo los
archivos del contrato, resuelve las paletas, excluye prompts sin licencia
reutilizable y escribe `catalog.json` + `NOTICE.md` + `LICENSE`. Es idempotente:
reemplaza el destino completo.

## Límites explícitos

Esta fase integra **conocimiento y assets portables**, no el runtime de Open
Design:

- **No se copiaron** el runtime ni el código de los plugins de Open Design.
  Son código acoplado a su propio runtime (Node/headless Chrome) y no forman
  parte de Olyvia. De los plugins sólo se portaron prompts y 13 composiciones
  HyperFrames autocontenidas, sin scripts.
- **HyperFrames con scripts/GSAP y Remotion** no ejecutan su runtime: 9 de
  ellas se incluyen como **preview MP4 oficial** (solo lectura, descargable y
  montable) en lugar de renderizarse localmente; la variante Remotion quedó
  fuera por completo. Las 13 renderizables son HTML + CSS `@keyframes` + fuentes
  locales y se procesan con WebCodecs; no se presenta el runtime completo como
  integrado.
- El generador produce **HTML, PNG, MP4 VP9 y PDF**. El video de diseño es corto
  (3 s, 15 fps por defecto) y el de HyperFrames llega a 30 s a 30 fps, sin audio
  ni JavaScript. H.264 no está disponible en WebCodecs de este equipo. El
  PNG/MP4 se puede enviar a Medios y montar en la timeline. Se descartó Chrome
  headless porque delegaba en la instancia abierta del usuario.
- Las previews se ejecutan en sandbox: las estáticas sin scripts, los
  componentes con `allow-scripts` y sin acceso al origen de Olyvia.
- Las marcas de los sistemas (Apple, Airbnb, Stripe, etc.) pertenecen a sus
  titulares; se usan como referencia visual, sin afiliación.

## Brief guiado (Discovery Question Form)

El generador incluye **Construir brief**: cuatro preguntas concretas (qué es,
para quién, qué debe lograr y tono/restricciones) componen un brief específico
en el campo real, sin IA ni llamadas de red. El botón sólo se habilita con las
tres primeras respuestas; el resultado se puede editar antes de generar.

## Handoff para desarrollo

El resultado del generador incluye **Copiar handoff**: arma un Markdown con
sistema, formato, brief, dirección elegida, modelo, tamaño del HTML, tokens
CSS completos, tipografías, paleta y reglas de craft, y lo copia al portapapeles.

- No inventa métricas ni datos: usa el sistema y los tokens reales cargados.
- Sirve para pegar el contrato en un ticket, una wiki o el chat del equipo de
  implementación; no crea archivos ni ejecuta código.
- Cubierto por test de UI con un portapapeles simulado y los tokens reales del
  sistema de prueba.

## Edición por instrucción (Patch Edit)

Dentro del resultado del generador hay un campo **Ajustar con una instrucción**:
el HTML actual y la instrucción viajan juntos como receta a `design_generate` y
devuelven una versión editada, conservando brief, sistema, craft y formato.

- No ejecuta scripts ni toca archivos: sólo reenvía el HTML (hasta 60 000
  caracteres del anterior) al proveedor y reemplaza la preview con la respuesta.
- El campo se limpia al aplicar y los errores del proveedor se muestran en
  pantalla; no hay un editor de código aparte ni un resultado simulado.
- Cubierto por test de UI; comparte el mismo comando y medición real que la
  generación inicial.

## Extracción de paleta (Design Extract local)

El botón **Extraer paleta** del hero abre un extractor con dos fuentes: imagen
local o URL pública.

- Lee la imagen en un canvas de 128×128, agrupa píxeles por cubos RGB, fusiona
  colores cercanos y elige hasta cinco dominantes con un acento legible.
- No usa red, modelos ni scripts; descarta transparencia, limita la imagen a
  12 MB y calcula contraste para el texto sobre el acento.
- Permite **aplicar la paleta a miniaturas y Motion** (misma selección que los
  sistemas) y **copiar tokens CSS**. No detecta tipografías: la imagen aporta
  la paleta, no el sistema completo.
- **URL pública**: comando Rust `design_extract_url` que descarga HTML/CSS
  acotados, lee colores hexadecimales y `font-family`, y bloquea hosts locales,
  IPs privadas, credenciales y redirecciones hacia redes privadas. No ejecuta
  scripts ni navega la página; sólo toma CSS inline y hasta 3 hojas del mismo
  host.
- Verificación real: una captura de Olyvia dio **5 colores**, acento `#edb5b6`,
  sin errores de consola; la selección quedó persistida. La extracción por URL
  se probó contra `https://example.com`: título correcto y 2 colores. Captura
  del extractor de imagen:
  [extractor](screenshots/olyvia-palette-extract-2026-10-29.png).

## Direcciones visuales (Direction Picker)

Antes de generar, el brief puede convertirse en **3 direcciones visuales
distintas** con el proveedor real:

- Cada dirección trae nombre, concepto, paleta de cinco colores hexadecimales,
  tipografías display/body, layout y una frase de por qué resuelve el brief.
- Al elegir una, el generador la usa como receta; la paleta y las fuentes se
  describen en el prompt, no se ejecutan.
- **Aplicar paleta** persiste el acento, fondo y texto de la dirección en la
  misma selección que Miniaturas/Motion, sin reemplazar el sistema activo del
  generador.
- Medición real 2026-10-29: FreeLLMAPI `auto` devolvió **3 direcciones**
  (Minimalist White · Bold Gradient · Dark Neon) con 6 000 tokens de margen.
  El modelo de razonamiento necesita ese margen; con 1 800/3 000 tokens se
  quedaba pensando antes del JSON y la app muestra el error real. El parser
  tolera prosa previa y valida cada paleta hexadecimal.
- Test live ignorado por defecto; la UI y el contrato están cubiertos con
  servicio falso.

## Revisión de diseño (Critique Theater)

El botón **Criticar diseño** del generador ejecuta una revisión real con el
proveedor configurado sobre el HTML generado:

- Cinco dimensiones: craft, problema, marca, accesibilidad y copy.
- Respuesta en prosa (sin JSON) con hallazgos ordenados por severidad y arreglo
  sugerido; límites de 60 000 caracteres de HTML y 1 600 tokens.
- Medición real 2026-10-29: **3 553 caracteres** de crítica en **14,1 s** con
  FreeLLMAPI `auto`; el test live se corre con `EDITOR_IA_RUN_RENDER_TESTS=1`.
- **Corregir con la crítica**: tras la revisión, el botón reenvía el HTML
  anterior y la crítica al generador para producir una versión corregida, con
  la crítica como receta. El bucle está cubierto por test de UI; el proveedor
  real se verificó en Rust. No se envía el HTML a ningún servicio sin la
  configuración de IA del usuario.

## Ejemplos oficiales

Los 201 ejemplos de los plugins oficiales se auditaron contra las plantillas y
skills base. Se suman **55 recetas** de decks y páginas (decks `fs-*`, `hps-*`, `huashu-*`,
`ve-*`, más páginas como `velar-*`, `article-magazine`, `blog-post`, `critique`)
como plantillas de diseño, y **45 referencias** de ejemplos que requieren
WebGL/GSAP/Remotion como skills de solo lectura (`motion-*`, `webgl-*`,
`open-design-homepage`, endpoints de plugins). De los ejemplos sólo se copian
`SKILL.md` y `LICENSE`: no se traen scripts, videos ni assets pesados. Los 101
restantes ya estaban cubiertos por plantillas/skills incluidas.

Verificación real: la receta `huashu-slides` abre el generador en formato deck y
`webgl-aurora-veil` aparece como referencia sin botón de generador.

## Scenarios y atoms oficiales

Los 27 flujos oficiales de Open Design (14 scenarios y 13 atoms, MIT) se copian
completos como **referencia de solo lectura**: Critique Theater, Design Extract,
Direction Picker, Handoff, Token Map, migraciones y exportaciones, entre otros.
No se ofrecen como receta del generador y no ejecutan código; conservan su
`SKILL.md`, referencias y contratos. Verificación real: Critique Theater aparece
como `Open Design · atom`, con licencia MIT y sin botón de generador, sin errores
de consola. Captura:
[workflows](screenshots/olyvia-open-design-workflows-2026-10-29.png).

## Skills comunitarias MIT

Además de las skills del paquete principal se copian completas las dos skills
comunitarias con licencia MIT:

- **Hallmark** (© Hallmark contributors): auditoría, rediseño y extracción de
  diseño anti-«AI slop»; 98 referencias. Se ofrece como receta de diseño.
- **Humanize PPT** (© LearnPrompt): sistema de outline y chequeo de decks;
  incluye contratos y scripts de referencia. Se ofrece como receta de deck.

Ambas conservan su `LICENSE` y se muestran con búsqueda, filtro por modo y
handoff al generador. Los 6 plugins comunitarios sin licencia declarada y los 2
de andamiaje de pruebas quedaron fuera (120 skills excluidas en total). Al
buscar una skill, el generador usa un sistema del catálogo completo aunque el
filtro deje la lista de sistemas vacía; la regresión está cubierta por test y
Playwright.

## HyperFrames (composiciones CSS reales)

La pestaña **HyperFrames** incluye 13 composiciones autocontenidas de los
plugins oficiales (Apache-2.0, derivadas de `frontend-slides` MIT):

- Vista previa en vivo con la composición real, escalada al panel, sin scripts.
- Render local a **MP4 VP9** con WebCodecs y captura por **SVG foreignObject**.
  Se eligió SVG en lugar de html2canvas porque el clon de html2canvas perdía
  las fuentes locales y el estado de las animaciones. La captura hornea estilos
  computados y desactiva animaciones en el clon para fijar el frame exacto.
- Medición real (2026-10-29): Bold Poster, **1920×1080, 3 s, 15 fps, 682.851 B**
  renderizado en **3,0 s**; `ffprobe` confirma VP9/15 fps/3,000 s y los frames
  de 0,1 s, 0,8 s y 2,8 s son distintos. Los 13 templates se capturaron a 5 s
  (59–400 ms por frame) con contenido visible y sin errores de consola.
- Guardar MP4, enviar a Medios y montar en la timeline usan el mismo puente que
  los diseños. El preview de cada tarjeta usa el `preview.png` incluido.
- Las 9 composiciones con scripts/GSAP se incluyen como **preview MP4 oficial**
  (Apache-2.0/MIT, sin audio): la UI permite verlas, guardarlas, enviarlas a
  Medios y montarlas, con un aviso de que su HTML no se ejecuta. Medición:
  Decision Tree, 10,47 s, reproduce y avanza `currentTime` en la app.
- Las fuentes son de Google Fonts (OFL-1.1) y se copian localmente como WOFF2.
  Evidencia: [UI](screenshots/olyvia-hyperframes-2026-10-29.png),
  [previews](screenshots/olyvia-hyperframes-preview-2026-10-29.png),
  [render](screenshots/olyvia-hyperframes-render-2026-10-29.png),
  [frame](screenshots/olyvia-hyperframe-frame-2026-10-29.png) y
  [MP4](screenshots/olyvia-hyperframe-2026-10-29.mp4).

## Imagen IA (texto a imagen real)

La biblioteca suma una pestaña **Imagen IA** que genera imágenes de verdad, sin
simulación ni placeholders:

- **Pollinations** (`https://image.pollinations.ai`), sin clave, pensado para
  fondos y pruebas. Límite gratuito real: una imagen cada 45 segundos por IP.
- **Proveedor configurado** (`/v1/images/generations` del gateway de Ajustes →
  IA), con `model`, `size` y `response_format: b64_json`; acepta `b64_json`,
  `data[0].url` y data URI. Si el gateway no tiene un proveedor de imágenes con
  credenciales válidas, la app muestra el error exacto del gateway.
- Los bytes se validan por firma (PNG, JPEG, WebP), se miden sus dimensiones
  reales desde la cabecera y se guardan con la extensión detectada. Se pueden
  guardar con diálogo nativo, enviar a Medios e montar en la timeline.
- El prompt de cualquier plantilla de Open Design se puede enviar a la pestaña
  con **Generar imagen**.
- Medición 2026-10-29: Pollinations devolvió un JPEG **512×512 de 45 163 B** en
  **6,9 s**, con la marca «pollinations.ai» en una esquina pese a `nologo=true`
  (el plan libre puede conservarla; la app lo advierte). Evidencia:
  [imagen generada](screenshots/olyvia-design-image-generation-2026-10-29.jpg). El gateway local (FreeLLMAPI) rechazó las pruebas con 403 de Vercel
  AI Gateway (falta tarjeta) y 401 de Cloudflare (clave inválida); no se inventó
  un resultado ni se ocultó el fallo.

Pollinations es un servicio externo opcional: no se distribuye su código y el
prompt viaja a su API. Sus términos y cuotas aplican fuera de Olyvia.

## Cobertura y auditoría

`npm run audit:open-design` verifica 2.391 invariantes del paquete generado
(conteos, archivos, licencias, ausencia de scripts/URLs remotas y extensiones
ejecutables). Última corrida: **0 fallos, 2.743 archivos, 30,5 MB**. Tabla
completa en [OPEN-DESIGN-COVERAGE.md](OPEN-DESIGN-COVERAGE.md).

## Evidencia

- Suite de Diseño: `open-design.test.ts`, `markdown.test.ts`,
  `design-selection.test.ts`, `DesignLibraryView.test.tsx`,
  `DesignGenerator.test.tsx`, `DesignImageGenerator.test.tsx`,
  `HyperframeView.test.tsx`, `hyperframe.test.ts`, `palette.test.ts` y el
  test de URL (55 tests) + 2 tests del puente con Motion.
- Playwright contra Vite (HyperFrames): 7 pestañas, 13 composiciones, preview
  real con fuentes, render 3 s/15 fps de 682.851 B, sin overflow ni errores de
  consola en 1440×980 y 860×980. Capturas: [UI](screenshots/olyvia-hyperframes-2026-10-29.png),
  [angosta](screenshots/olyvia-hyperframes-narrow-2026-10-29.png).
- Playwright contra Vite: 99 plantillas y 59 skills listadas, previews reales
  de `blog-post` y `release-notes-one-pager`, recetas enviadas al generador y
  skills de utilidad sin botón de generación, sin errores de consola.
- Ronda real del generador: FreeLLMAPI `auto`, **26,7 s**, **4 022 caracteres**
  de HTML seguro, render 1080×1080 sin scripts ni recursos externos; el test
  Rust queda ignorado por defecto y se corre con `EDITOR_IA_RUN_RENDER_TESTS=1`.
- Playwright contra Vite (1440×980 y 860×980): 152 sistemas renderizados,
  preview `colors.html` cargada, aplicación a miniaturas con
  `accent: #60a5fa`, craft y prompts completos, sin errores de consola ni
  overflow horizontal.
- Playwright (1440×980 y 860×980) de Imagen IA: 6 pestañas, formulario y
  preview sin overflow horizontal y sin errores de consola. Capturas:
  [imagen ancha](screenshots/olyvia-design-image-2026-10-29.png) y
  [angosta](screenshots/olyvia-design-image-narrow-2026-10-29.png).
- Capturas: [biblioteca](screenshots/olyvia-design-library-2026-10-29.png),
  [aplicada a miniaturas](screenshots/olyvia-design-thumbnails-2026-10-29.png),
  [craft](screenshots/olyvia-design-craft-2026-10-29.png) y
  [angosto](screenshots/olyvia-design-narrow-2026-10-29.png).
