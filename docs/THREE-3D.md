# Escenas 3D on-demand (Fase 5)

Fecha: 2026-10-31. Three.js (MIT) renderiza escenas 3D deterministas y el
resultado se **hornea a un MP4 VP9** que entra a Medios. No hay un segundo
timeline ni un segundo motor de export: el clip horneado se edita y exporta con
el pipeline existente (preview WebGL/CSS + FFmpeg).

## Escenas

| Preset | Geometría | Cámara | Objeto |
|---|---|---|---|
| `orbit-cube` | cubo | órbita de −0,7 a +0,7 rad, altura 2,1→2,5 | giro Y π, balanceo X |
| `torus-dolly` | toroide anudado | dolly out 4,6→8,0 | giro X/Y continuo |
| `sphere-studio` | esfera | cámara fija (0,4; 1,8; 5,6) | giro Y π/2, flotación |
| `grid-flythrough` | icosaedro | avance Z 6,2→2,8 y descenso | giro X/Y |

Todas incluyen piso circular, grilla, luz hemisférica, direccional y una luz de
acento que orbita. Colores por preset; tone mapping ACES; `preserveDrawingBuffer`
para leer el canvas frame a frame.

## Pipeline

1. `createThreeScene({preset,width,height,modelUrl?})` importa Three.js
   **dinámicamente** y devuelve `renderAt(progress)`; no se inicializa hasta
   pulsar Previsualizar/Generar. Con `modelUrl` carga el modelo con
   `GLTFLoader` (también dinámico), lo centra y lo apoya en el piso usando la
   cámara, luces y fondo del preset.
2. `renderScene3DToVideo` monta un `VideoEncoder` VP9 (`vp09.00.10.08`) y
   `mp4-muxer`, renderiza cada frame con progreso 0..1 y cierra el `VideoFrame`.
   Resolución 720p/1080p, 24 fps, 1–10 s (VP9 en MP4, el mismo contenedor que
   ya usa Design).
3. El panel **Escena 3D** de Motion permite previsualizar un frame, generar y
   **Enviar a Medios** (`stageDesignMedia` + `importMediaPaths`), que agrega el
   asset al proyecto y abre el editor.

## Modelos importados (glTF/GLB)

La herramienta `three_add` acepta `modelPath` además de `preset`: carga un
`.gltf` o `.glb` local, calcula su caja, escala por la dimensión mayor a 2
unidades, lo centra en X/Z y lo apoya sobre el piso (`modelPlacement`, función
pura con tests). La cámara orbital, la grilla, el piso y las tres luces del
preset siguen actuando. En el puente en vivo la ruta debe estar dentro del
workspace (Rust la canonicaliza antes de emitir el pedido); en el MCP de
archivos la herramienta existe pero el horneado requiere la app abierta.

## Animaciones glTF

Si el modelo trae animaciones, se reproduce **el clip elegido** (por nombre o
índice; sin pedido, el primero) con `AnimationMixer` a lo largo del horneado: cada frame hace `setTime(progreso ×
duración)` con un tope en el 99,9 % para no caer justo en el borde del loop. La
rotación automática del preset se desactiva para que el clip mande, mientras la
cámara y las luces siguen su curso. Como Three.js anima nodos, sirve también
para animaciones de esqueleto y morph targets. La herramienta acepta `animation` y devuelve
`animation: {name, durationSeconds}` más `animations: string[]` en `data`; un
nombre/índice inexistente falla enumerando los disponibles.

## Rótulo 3D (sprite o extruido)

`three_add` acepta `text` (hasta 120 caracteres). Sin `textDepth` se dibuja en
un canvas con la tipografía del sistema, se convierte en `CanvasTexture` y se
monta como `Sprite` siempre de cara a la cámara (`depthTest:false`). Con
`textDepth` (0,02–0,6 unidades) se genera `TextGeometry` con la fuente
**MgOpen Helvetiker** incluida, bisel suave, escala automática a 3,5 unidades de
ancho y material metálico iluminado por el preset. La geometría y el material se
liberan al terminar.

## Verificación

- **4 tests unitarios** de presets/cámara/rotación y encaje de modelos
  (`scene.test.ts`, incluye `modelPlacement`).
- **Animación real y selección de clip** (`scripts/verify-three-animation.mjs`,
  2026-10-31): GLB de 1.672 B con dos clips (Giro/Pulso). Pedir “Pulso” devolvió
  `animation.name:"Pulso"`, `animations:["Giro","Pulso"]` y horneó **1.296.076
  B** de VP9 (3 s, 1280×720); los frames 0,3/1,5/2,7 s muestran el cubo
  creciendo y volviendo, y una animación inexistente falló con “no existe”.
  La prueba anterior con “Giro” (1.330.925 B) sigue documentada en el historial.
- **Rótulo sprite real** (`scripts/verify-three-text.mjs`, 2026-10-31): escena
  `orbit-cube` con “Hola Olyvia” → VP9 **910.936 B**, 2 s, 1280×720; frames
  0,5/1,5 s con el texto blanco centrado sobre el cubo y el cubo girando.
- **Texto extruido real** (`scripts/verify-three-text.mjs --depth 0.22`,
  2026-10-31): “Olyvia 3D” con profundidad 0,22 → VP9 **941.516 B**, 2 s,
  1280×720; el frame 0,5 s muestra caras laterales y bisel, no un sprite plano.
- **Importación real por MCP en vivo** (`scripts/verify-three-model.mjs`,
  2026-10-31): proyecto creado por el MCP de archivo, `three_add` con
  `modelPath` de un GLB de 928 B, `clip_add` y `render_start`. El horneado
  VP9 de 3 s produjo un asset de **1.359.831 B**; el render final quedó en
  **1.791.037 B, 3 s, 1920×1080/30 fps h264+aac**, con frames distintos en
  0,5/1,5/2,5 s y revisión visual (cubo cian centrado, apoyado sobre la grilla,
  girando con la cámara orbital). El mismo script importa además un `.gltf`
  con buffer base64 embebido (1 s, asset de **404.967 B**), lo que requirió
  agregar `data:` a `connect-src` en la CSP: antes `GLTFLoader` no podía leer
  el buffer data URI.
- El perfil de WebView2 del test se aisló con `WEBVIEW2_USER_DATA_FOLDER`
  porque la app restaura el último proyecto al abrir y el puente en vivo toma
  ese proyecto como workspace, reemplazando el `--mcp-workspace` de la corrida.
- **1 test E2E Chrome real** (`e2e/three-preview.spec.ts`): renderiza dos frames
  en WebGL y hornea 1 s 320×180/12 fps. Resultado medido: **15.229 px**
  visibles en el primer frame, **21.905** en el segundo, diferencia acumulada
  **3.757.634** y MP4 de **50.643 bytes**.
- **1 test de UI** que monta el panel en Motion (sin WebGL).
- Build: chunk `three.module` de **704,88 kB** (gzip 181,18 kB) separado del
  bundle principal.

## Licencias

- Three.js 0.180.0 — MIT; aviso en `THIRD-PARTY-NOTICES.md`, en el aviso del
  instalador y en `docs/LICENSES.md`.
- `@types/three` es sólo de desarrollo y no se distribuye.
- mp4-muxer 5.2.1 — MIT (ya estaba por Design).

## Límites

- **Baked**: la escena es un video; no se puede re-encuadrar en el timeline como
  una escena 3D viva. Para cambiarla se regenera.
- El rótulo plano sigue siendo un **sprite**; con `textDepth` es geometría
  extruida con una única fuente incluida (MgOpen Helvetiker), sin fuente
  personalizada ni animación por glifo.
- Si no se pasa `modelPath`, sólo hay cuatro presets con primitivas. La
  importación glTF/GLB no reproduce animaciones de esqueleto ni morph targets:
  el modelo se muestra y gira como objeto rígido.
- El modelo se carga desde la ruta indicada usando el protocolo de assets de
  Tauri: en vivo debe estar dentro del workspace; en el MCP de archivos la
  herramienta existe pero el horneado necesita la app abierta. Los buffers
  base64 funcionan desde este build; las texturas externas deben estar dentro
  del scope del proyecto.
- Sin alpha: el MP4 VP9 se hornea opaco (no hay composición 3D con
  transparencia).
- Requiere WebCodecs VP9 y WebGL2 en el WebView; si faltan, el panel muestra el
  error y no inventa una salida.
- 1080p/10 s tarda varios segundos y consume CPU/GPU del equipo.
