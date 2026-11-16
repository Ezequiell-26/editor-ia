# Análisis de brechas — AlaukCut → Olyvia (2026-11-09)

**Alcance:** inventario estático de la instalación de AlaukCut
(`C:\Users\ofici\AppData\Local\Programs\AlaukCut`, LEEME: software comercial
de terceros — se extraen patrones y features, **no código ni assets**). Cruce
contra el estado real de Olyvia en este árbol.

**Fuentes AlaukCut:** `frontend/js/*.js` (105 módulos vanilla, ~68k líneas),
`backend/*.pyc` (57 módulos, clase `Api` con 252 métodos RPC pywebview),
`backend/shaders/*.hlsl`, `ferramentas/` (ffmpeg custom, whisper.cpp, RIFE,
YuNet, MediaPipe). **Base de conocimiento organizada: `docs/reference/
alaukcut/`** (índice + 8 docs temáticos + anexos con firmas completas).
Mapa original en `memory/2026-11-09-alaukcut-architecture.md`.

## Matriz de brechas priorizada

| Feature AlaukCut | Qué hace | Estado en Olyvia | Prioridad |
|---|---|---|---|
| `area_segura.js` | Guías de zona segura por plataforma (reels/stories/feed/tiktok/shorts/tv) con polígonos cover+safe+título y aviso de aspecto | **HECHO (parcial→preset)**: existían 2 zonas fijas; ahora hay presets por plataforma en el monitor | ✅ implementado hoy |
| `cursor_mouse.js` + `cursor_estilos.js` | Cursor estilizado (3 estilos, 4 colores, tamaño, onda) para tutoriales | ❌ sin equivalente | Alta (tutoriales) |
| `rastreamento.js` + `rastreio.pyc` + YuNet | Tracking de cabeza/objeto: sigue región, suaviza (sigma), blur de fondo, auto-corte | ❌ sin tracking de movimiento | Alta (efectos pinneados) |
| `camera_inteligente.js` | Auto-reframe con zoom de seguimiento (máx 6×, curvas, permanencia) | 🟡 multicam auto-cut existe; auto-reframe no | Media-Alta |
| `molduras.js` + `moldura_monitor.pyc` | Marcos decorativos para screen recordings (formas, halo) | ❌ | Media |
| `maozinha.js` + `tracado.pyc` | Mano/dibujo libre anotando video (pen hand, trazos) | 🟡 PolygonEditor existe para máscaras, no anotación en video | Media |
| `hyperframes*.pyc` | HTML/CSS → video (motion graphics por navegador headless) | 🟡 Lottie+stickman+nodeditor cubren parte; HTML→video no | Media |
| `rife/` + `suavizar.pyc` | Interpolación de frames RIFE (ncnn-vulkan) y suavizado óptico | ❌ sin interpolación | Media (binario externo MIT) |
| `motorcpp.pyd` + `motor_nativo.pyc` | Motor nativo C++/HLSL: preview por texturas, webcam+chroma, captura pantalla, loopback audio, codificador con auto-fallback | 🟡 Olyvia renderiza por FFmpeg; preview canvas/WebGL; sin motor compositor nativo | Baja (arquitectura distinta, ya cubierto por video-rs/FFmpeg) |
| `previa_dupla` | Preview dual-monitor / A-B | ❌ | Baja |
| `agente*.pyc` | Agente IA con conectores Claude/Codex | ✅ Olyvia tiene más (MCP ~108 tools, providers, factory) | — |
| `atualizacao.pyc` + `licenca.pyc` | Auto-update y licencia propia | 🟡 update pendiente (firma EV/OV); licensing en fase 3 | Media |
| `caixa_silencio.js` | Corte de silencios | ✅ `silence-cuts.ts` | — |
| `legendas.pyc` + whisper | Subtítulos whisper.cpp | ✅ faster-whisper + ASS burn | — |
| `sem_fundo.pyc` | Remoción de fondo (MediaPipe) | ✅ background removal ONNX | — |
| `pessoa.pyc` | Segmentación de persona | 🟡 verificar paridad con `media/mod.rs` | Baja |
| `exportar_av1/prores/gif` | Export multi-formato | ✅ export_tools con av1/prores/gif | — |
| `gravar_webcam_chroma` | Chroma key en webcam de grabación | 🟡 chroma existe en timeline; en grabación verificar | Baja |
| `luts_camera.py` | LUTs de cámara | ✅ LUT 3D + `color_lut.rs` | — |
| `idiomas.pyc` | i18n pt/en/es | 🟡 Olyvia es ES; i18n no prioritario | Baja |
| `transicoes_cine.js` | Transiciones cinematográficas por atlas | ✅ transiciones incl. slide-3d, luma-wipe | — |
| `espectro`/`medidor_db` | Medidores de audio | ✅ audio scopes LUFS | — |
| `copia_leve.pyc` | Copias optimizadas / caché | ✅ proxies | — |

## Implementado en esta pasada

**Guías de área segura por plataforma** (`state/safe-area-presets.ts` +
`Preview.tsx`): presets YouTube/TV, TikTok, Reels, Stories, Shorts y Feed 4:5
con rectángulos cubiertos, polígono seguro, polígono de título (YouTube) y
aviso cuando el aspecto del proyecto difiere del formato destino. Persistido
en `editor-preferences.safeAreaPreset`; select en el toolbar del monitor.
Verificación: `safe-area-presets.test.ts` 6/6 + `editor-preferences.test.ts`
10/10 · `npm run typecheck` OK.

## Mapa de layout "cada posición" (editor.html)

Estructura del editor AlaukCut, de arriba a abajo:

- **Región 0 — barra superior**: logo + menús de texto «Arquivo» (con
  «Projetos» dentro), «Versão», «Atualização»; pestañas de proyecto.
- **Regiones 1–3 — cuerpo en 3 columnas**:
  - *Izquierda*: panel de pestañas — `mídia`, `áudio`, `texto`, `stickers`,
    `efeitos`, `transições`, `legendas` (con sub-trilho), `filtros`,
    `animações`, `templates`. Incluye «Telas» y «Gravar tela» al pie del
    panel Mídia (crean material, no son comandos del proyecto).
  - *Centro*: `painel-previa` — monitor con toolbar (comparar, frame real,
    guías+selector de área segura, scopes, calidad, ratio, zoom, fit).
  - *Derecha*: `painel-inspetor` — propiedades del clip seleccionado
    (transform, cor, efeitos con intensidad/velocidade, filtros, máscara
    pincel, rastreamento, subtítulos).
- **Región 4 — timeline**: pistas, regla, toolbar propia (zoom, transições,
  marcador de voz/silencio).
- **Columna IA derecha** (`ia-coluna`): asistente + Hyperframes (avisa si
  el paquete no lo trae).
- **Otras pantallas**: `index.html` (home: tarjetas de proyecto con
  capa/nombre/fechas/duplicar/renombrar/excluir), `oferta.html` (paywall),
  `ativar.html` (licencia), `previa_dupla.html` (preview secundario).

Equivalente Olyvia: sidebar de navegación + hub de assets + preview con
monitor/tools + Inspector + Timeline + AssistantDock + vistas
Director/AutoEdit/Visuals/Motion. La paridad de *zonas* ya existe; las
diferencias son de densidad y de qué herramientas viven en cada panel.

## Siguientes candidatos (por impacto para el flujo de tutoriales)

1. **Cursor estilizado + clicks** — dos modos en AlaukCut: (a) `cursor_editar`
   reemplaza el cursor de la propia app (CSS `image-set` + PNG generado por
   canvas, ripple `onda` al click); (b) `cursor_gravar` empaqueta el cursor
   (bitmap BGRA + hotspot + params de anillo) y el motor nativo lo quema en
   la grabación de pantalla. En Olyvia: opción de estilo de cursor en
   `RecordView` + composición del overlay en el pipeline de captura/export.
   Requiere: assets de cursor propios, conversión a clip/overlay o filtro
   ffmpeg, UI de estilos. Feature firma para tutoriales.
2. **Tracking de objeto/cabeza** — YuNet ONNX (detección) + tracker; pin de
   zoom/efecto a región. Requiere Rust + ONNX + keyframes automáticos.
3. **Auto-reframe** — deriva del tracking; crop animado siguiendo sujeto.
4. **Marcos de monitor** — overlay PNG/SVG en export; el más barato de los
   pendientes grandes.
5. **Interpolación RIFE** — evaluar binario externo vs filtro ffmpeg
   `minterpolate`; licencia MIT ok, requiere justificar dependencia.
