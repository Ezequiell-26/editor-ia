# 02 — Frontend AlaukCut (105 módulos JS, ~68k líneas)

Vanilla JS sin bundler: cada `<script>` en `editor.html`. Los nombres son
pt-BR y autodescriptivos. Export real vía `window.X` o const global.

## Núcleo del editor

| Módulo | Líneas | Rol |
|---|---|---|
| `timeline.js` | 7019 | Corazón: tracks, clips, trim/split/move, snapping, marcadores en timeline, drag&drop, mini-mapa, atajos de edición |
| `motor.js` | 6172 | Motor de preview WebGL2: compositor de capas, keyframes, efectos, transiciones GLSL, texto, máscaras |
| `inspetor.js` | 3653 | Inspector derecho: propiedades del clip/efecto/audio por contexto |
| `editor.js` | 3148 | Orquestador del editor: estado del proyecto, imports, acciones globales |
| `faixas.js` | 1690 | Modelo de datos de tracks/faixas (tipos, orden, props) |
| `exportador.js` | 2237 | Pipeline de exportación: resolución, codec, progreso |
| `menu_clipe.js` | 1235 | Menú contextual del clip (click derecho) |
| `menu_topo.js` | 513 | Barra de menús superior (Archivo/Editar/Ver/Ayuda…) |
| `paineis.js` | 425 | Layout de paneles y columna IA |
| `telas.js` | 327 | Gestión de las "telas" (vistas/pantallas) |

## Preview (render en tiempo real)

| Módulo | Rol |
|---|---|
| `previa.js` | Orquestador del monitor de preview |
| `previa_midia.js` (951) | Decodificación de frames de medios para el motor |
| `previa_dupla.js` | Vista A/B lado a lado (antes/después) |
| `previa_efeitos.js` | Preview de efectos sobre clip |
| `previa_legendas.js` | Preview de subtítulos |
| `previa_nativa.js` | Bridge al preview nativo (WebSocket/texturas) |
| `previa_stickers.js`, `previa_templates.js`, `previa_transicoes.js` | Previews específicos por tipo de capa |
| `decodificador.js` (586) | Decodificación de video (WebCodecs/MSE) para preview |
| `mp4_leitor_worker.js` | Worker que lee MP4 (moov atom, frames) |
| `cabecalho_mp4.js` | Parser del header moov del MP4 |
| `prerender.js` + `prerender_nativo.js` + `prerender_ui.js` + `agendador.js` | Pre-render de segmentos pesados en background con cache por firma (`assinaturas`, `veredito`, `baldes`) |

## Sesión nativa (bridge JS↔motor C++)

| Módulo | Rol |
|---|---|
| `sessao_nativa.js` (714) | Cliente del WS `/nativo/ws`: serializa capas JSON, sube texturas, maneja generaciones/reuso de texturas efímeras, LUTs, stats por clip |

## Grabación

| Módulo | Rol |
|---|---|
| `gravar_tela.js` (996) | UI+flujo de grabación de pantalla/webcam/audio PC; obtiene `CursorMouse.pacoteGravacao()` (bitmap BGRA + hotspot + config de onda de click) y envía al backend nativo |
| `cursor_mouse.js` (290) | Config del cursor: estilos (clásico/llena/3D), colores, escala, indicador de click; genera SVG→CSS cursor para el editor y paquete bitmap para grabación |
| `cursor_estilos.js` | Datos de los estilos/colores de cursor |
| `molduras.js` | Marcos/molduras para webcam en grabación |
| `maozinha.js` (425) | "Manito" que señala elementos en tutoriales (flecha animada sobre el video) |
| `maozinha_segundos.js` | Variante con segundos |
| `capturar_imagem.js` | Captura de frame como imagen |
| `escolher_onda.js` | Selector de estilo de onda de click |

## Efectos, color, formas

| Módulo | Rol |
|---|---|
| `transicoes_gl.js` (35 líneas, 36 KB) | **Shaders GLSL de transiciones embebidos como strings** (~20 transiciones MIT de transitions.dev + ~12 propias "AlaukCut" con comentarios de paridad) |
| `transicoes_cine.js` | 31 "cinemáticas" = transiciones por secuencia de imágenes (grid 4×4) |
| `inspetor_cor.js` (1047) | Ruedas HSL, curvas, scopes de color en inspector |
| `cor.js` | Grupos/constantes de color |
| `escopo_cor.js` | Scopes de vídeo (waveform/vectorscope) |
| `espectro.js` | Espectro de audio |
| `luts.js` + `luts_camera.js` | LUTs .cube + transformación de espacio de color de cámara (primarias, curva, VISUAL) |
| `filtros_dados.js` (42 KB) + `filtros_criativos_dados.js` (54 KB) | Catálogos de filtros/LUTs con parámetros |
| `formas.js` | Formas dibujables (shapes) para overlays |
| `mascara.js` + `mascara_desenho.js` | Máscaras de imagen (pincel) y máscaras de texto/dibujo animadas |
| `contorno.js` | Contorno/trazado de texto |
| `curvas_predefinidas.js` | Presets de curvas de velocidad |
| `regiao_efeito.js` | Efecto aplicado a una región del frame |
| `canto_fixado.js` | Esquinas fijas (picture-in-picture anclado) |
| `animacoes.js` + `animacoes_dados.js` | Sistema de animaciones de entrada/salida de capas + catálogo |
| `emojis_animados.js` | Stickers emoji animados (se "graban" como assets) |
| `stickers` (panel) + `pessoa.js` | Stickers y recorte de persona (segmentación) |

## Tracking y cámara

| Módulo | Rol |
|---|---|
| `rastreamento.js` + `palco_rastreamento.js` + `inspetor_rastreamento.js` | Tracking de punto/objeto en el clip (el backend usa YuNet/MediaPipe); escenarios de seguimiento en el palco |
| `camera_inteligente.js` | "Cámara inteligente": curvas de movimiento automático (pan/zoom que sigue la acción) |
| `roda_zoom.js` | Control de zoom tipo rueda en preview |
| `palco_camera.js`, `palco.js`, `palco_mascara.js`, `palco_sem_fundo.js` | Overlays de interacción en el monitor (handles de cámara, máscara, recorte de fondo) |

## Audio

| Módulo | Rol |
|---|---|
| `medidor_db.js` | Medidor de nivel dB |
| `sons.js` | Biblioteca de efectos de sonido |
| `caixa_silencio.js` | Eliminación de silencios (detección de gaps) |
| `caixa_numero.js` | Caja de número (lower-third con contador?) |
| `marca_texto.js` | Marcado de texto hablado → subtítulos |
| `biblioteca` (backend) | Biblioteca de sonidos descargables |

## Subtítulos y texto

| Módulo | Rol |
|---|---|
| `legendas_formato.js` | Formato de subtítulos (estilos, posición) |
| `lista_fontes.js` | Lista de fuentes del sistema |
| `marcadores.js` (741) | Marcadores de tiempo + "batidas" (beats de música) + montaje IA |
| `inspetor_animacao.js`, `inspetor_movimiento.js` | Animación y movimiento en inspector |

## IA y agente

| Módulo | Líneas | Rol |
|---|---|---|
| `agente_ponte.js` | 5498 | **El puente del agente IA**: ops, props de máscara, traducción de instrucciones del usuario a operaciones de timeline |
| `assistente_ui.js` | 1646 | UI del asistente/chat lateral |
| `conversa_terminal` (backend) | — | Terminal IA integrada (Claude/Codex CLI) |
| `novidades.js` | 3739 | Changelog/noticias in-app |

## Utilidades UI

`atalhos.js` (atajos de teclado), `dialogo.js`, `dicas.js` (tooltips),
`historico_ui.js` (undo UI), `home.js`, `idioma.js` + `idiomas/`
(i18n pt/en/es), `ajuda.js` + `help_base.js` + `help_alaukcut.js`
(sistema de ayuda contextual), `suporte.js` (diagnóstico/envío),
`impressao.js` (export a imagen?), `export_diario.js`,
`formato_personalizado.js`, `copia_leve.js` (copia rápida de video),
`espiada.js` + `espiada_midia.js` ("espiada" = vista rápida/mirada?),
`preparo_videos.js`, `prontidao.js`, `placa_perdida.js` (aviso de GPU
caída), `seletor_cor.js` (EyeDropper), `atalhos`, `area_segura.js`
(presets por red social), `midias_pastas.js` (organización de medios),
`exportar_formato.js`/`exportar_prores.js`/`exportar_resumo.js`
(diálogos de export por formato), `cabecalho_mp4.js`,
`previa_dupla`, `suavizar` (backend: suavizado de clips).
