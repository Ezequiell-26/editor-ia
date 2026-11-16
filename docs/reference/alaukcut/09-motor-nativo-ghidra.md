# 09 — Motor nativo analizado con REA + Ghidra (nivel código)

> Análisis de `backend/motorcpp.cp311-win_amd64.pyd` con REA 6.4.0 +
> Ghidra 12.1.4 el 2026-11-09. Evidencia:
> `ev_71eab92947390c437e7234bb62fc95ff77b5a5907581cc9b8a45da38ef6841ea`
> (overview), `ev_f5cc4ea121d70d984572f593fe60b0ea484c1c840bca5e00834b5c0b494d4c08`
> (strings), `ev_6190f1bf1b955d0b85f18a68467dff5cef0590c84a0fad4bc3ec1d1fd01f5613`
> (xrefs), `ev_f6b289339b053220c48ab8e553ada713a5a4c272ebb619e82f55fc029a50aaf2`
> (decompile).
> SHA-256 del binario: `47488a8b9ada5c92ffcbaad0f78c071d57f165371c38128f429987e229b2f46a`.

## Hechos del binario (verificados)

- **Binding**: pybind11 v11, MSVC (`__pybind11_internals_v11_msvc_md_mscver19__`,
  Python 3.11). Por eso no hay tabla `PyMethodDef`: los `m.def` se resuelven
  en runtime. Las firmas pybind11 (`(...) -> dict`) quedaron embebidas en
  docstrings y son recuperables por strings.
- **Identidad**: docstring del módulo =
  `"EditorAlanCpp - motor nativo (Etapa F). F3: esqueleto e placa."`
- **Tamaño real del análisis**: 1.888 procedimientos, 1.710 strings,
  1.793 funciones en `.pdata`, 10.998 strings ASCII extraíbles.
- **Stack gráfico**: Direct3D 11 + **Direct2D** (efectos descritos:
  partículas, caída, espectro) + **DirectWrite** (raster de leyendas,
  `rasterizar_legenda`, `raster_legenda_jumper`, `raster_texto_teste`).
- **Media Foundation en ambos sentidos**:
  - Decode: `MFCreateSourceReaderFromURL` + `MFCreateDXGIDeviceManager` +
    `MFCreateMediaType` + `SetCurrentMediaType` + `ResetDevice`
    ("la placa não entrega ARGB32 deste video").
  - Encode: `MFCreateSinkWriterFromURL` + `MFCreateMediaType` entrada/salida.
  - **Cero-copia GPU→encoder**: `MFCreateDXGISurfaceBuffer` +
    `MFCreateSample` + `SetSampleTime` + `SetSampleDuration` +
    `AddBuffer` + `WriteSample` — los frames nunca bajan a RAM.
- **Salida por FOURCC**: `"H264"`, `"HEVC"`, ``"apcn"` (ProRes 422),
  `"AVdn"` — `codificadores_de_video` devuelve qué codificadores hay por
  FOURCC en esa máquina.

## Pipeline de render (direcciones Ghidra)

```
plano JSON (frontend)
  → FUN_180023a40  ler_e_decodificar / desenhar_e_sincronizar / medir_desenho
  → FUN_180022270  desenhar_quadro  ("quadro: lendo camadas (decodifica video)")
  → FUN_180022b00  previa_desenhar_na_janela
        stats: ler_ms, desenhar_ms, placa_ms, trocar_ms + Present
  → FUN_1800265c0  pedaco: ler camadas → esperar textura → desenhar
  → FUN_180025330  produzir_pedaco (stats por etapa, dict a Python)
  → FUN_180027200  codificar_lote  (export: WriteSample por quadro)
  → FUN_180028050  fechar_codificacao (Finalize + stats finales)
```

### Stats/telemetría que devuelve (claves del dict, evidencia literal)

- `produzir_pedaco`: `quadros`, `quadros_desenhados`, `abriu_agora`,
  `total_s`, `ler_s`, `desenhar_s`, `esperar_anel_s`, `formato`,
  `codificador`, `escolha_codificador`, `tentados`, `imagem_prova`,
  `cabecalho_do_fluxo`, `dados`, `dentro`, `parado`, `erro`.
- `previa_desenhar_na_janela`: `ler_ms`, `desenhar_ms`, `placa_ms`,
  `trocar_ms`, `pronta`.
- `fechar_codificacao`: contadores `_n_decodificacoes`,
  `_n_fontes_abertas`, `_n_fontes_soltas`, `_n_quadros_lidos`,
  `_mb_copiados`, `_apertos_de_memoria`, `_resto_do_ler`,
  `onde_foi_o_tempo_no_cpp`, `nome_conferido`, `hardware`, `taxa`,
  `velocidade`, `rasterizar_legenda`, `saida`.
- Benchmarks: `medir_desenho` → `media_ms`, `mediana_ms`, `p95_ms`,
  `pior_ms`; `fontes_de_video` (abiertas/teto/salidas); `diag_video`
  (carimbos de tiempo del decodificador); `placa` (adapter DXGI);
  `placa_caiu` / `reabrir_placa`.

### Anillo de texturas ("MOTOR_ANEL")

El motor mantiene un **anillo de texturas GPU** entre decodificación y
dibujo: si el codificador/dibujo va lento, el productor **espera**
(`esperar_anel_s`, "o codificador não soltou textura em 20 s") en vez de
copiar a RAM. `MOTOR_ANEL` es la env var de tamaño del anel.

## Resiliencia de placa (GPU)

- `DXGI_ERROR_DEVICE_REMOVED` = `0x887A0005` se detecta en todas las
  rutas ("a placa foi removida [prova]").
- Hooks de prueba: `MOTOR_PROVA_PLACA_CAI`, `MOTOR_PROVA_PLACA_CAI_FECHAR`.
- Recuperación: `placa_caiu()` → `reabrir_placa()` suelta todo lo nacido
  en la placa caída y abre una nueva; `MF ResetDevice` para el decoder.
- Selección de adaptador: lista DXGI (no `EnumDisplayMonitors`; mapean
  monitores↔placa), env `MOTOR_ADAPTADOR` (LUID `10_0`/`11_1` =
  GPU+salidas), preferencia persistida en
  `%LOCALAPPDATA%\EditorAlan\placa_escolhida.txt`, fallbacks `warp`
  (WARP software) y "escolha do Windows".
- Cache de texturas dimensionado por VRAM (`cache_textura_mb(vram)`).

## Capability-query pattern (importante para Olyvia)

El frontend **no duplica listas**: llama `*_suportada(s)`/`_*_suportados`
y el motor responde desde la tabla real. Funciones-verificación que
existen (todas devuelven bool/list/dict):

`transicoes_suportadas`, `provar_transicoes` (compila TODOS los shaders
HLSL de transición y devuelve nombre→error), `efeitos_suportados`,
`formas_efeito`, `chroma_suportado`, `mascara_suportada`, `lut3_suportada`,
`webcam_suportada`, `codificadores_de_video`, `modo_do_codificador`,
`definir_codificador`, `audio_entradas`, `monitores_placa`, `placa`,
`fontes_de_video`, `acabamento_efeitos`, `manter_cor` (uManter de
camada.hlsl), `lower_third`, `video_fundo_transparente`, `desenhar_desenho`.

## API nativa recuperada (dirección → función)

Mapa completo string↔función en `anexos-rea/func-strings.txt` (340
funciones con strings) y `anexos-rea/api-nativa-firmas.txt` (firmas
pybind11 recuperadas). Funciones clave:

| Dirección | Función (nombre Python) | Rol |
|---|---|---|
| 0x180022270 | `desenhar_quadro` | compositor de un cuadro |
| 0x180022b00 | `previa_desenhar_na_janela` | preview + Present + stats ms |
| 0x180023a40 | `medir_*` bench | decode/draw/sync timing harness |
| 0x180024d90 | percentiles | media/mediana/p95/pior ms |
| 0x180025330 | `produzir_pedaco` | pre-render por pedazos + stats |
| 0x1800265c0 | pedaco interno | ler→esperar anel→desenhar |
| 0x180026e30 | `abrir_codificacao` | export: SinkWriter + stats init |
| 0x180027200 | `codificar_lote` | export: WriteSample loop |
| 0x180028050 | `fechar_codificacao` | Finalize + contadores finales |
| 0x180029500 | `cancelar_codificacao` | cancelación limpia |
| 0x18002a260 | `codificar_planos` | planos sin cuadro intermedio |
| 0x18002a8d0 | `PyInit` + registro | init del módulo, ~131 strings |
| 0x180031f20 | selección GPU | adaptadores, env, placa_escolhida |
| 0x180034d50–0x180039xxx | audio/webcam/chroma | WASAPI loopback, captura, keying |
| 0x180039620 | `transicoes_suportadas` | lista transiciones (kTransicoes) |
| 0x180039780 | `provar_transicoes` | compila todos los shaders HLSL |
| 0x180039a40+ | raster_legenda_*, desenhar_teste, medir_desenho, diag_video | texto/banco de pruebas |

Pseudocódigo de `produzir_pedaco` (FUN_180025330): `anexos-rea/decomp-encoder-open.c`.

## Lecciones replicables en Olyvia (Rust/FFmpeg)

1. **Stats por etapa en cada operación pesada** — Olyvia debería devolver
   `{ler_s, desenhar_s, esperar_s, total_s}` por export/pedazo, no solo
   duración total. Barato de implementar en `render-worker`.
2. **Cadena de codificadores con `tentados`** — probar NVENC→MF→QSV→SW y
   reportar qué se intentó y por qué falló cada uno.
3. **Detección de GPU perdida** — ffmpeg/nvenc puede morir igual; patrón
   `placa_caiu → reabrir` aplica a nuestro pipeline de proxies/render.
4. **Capability-query**: exponer `*_supported()` desde el motor Rust y
   que el frontend pregunte, en vez de hardcodear listas en TS.
5. **Anillo de frames/texturas** con backpressure en vez de RAM staging.
6. **Adaptador GPU fijado por config** (`MOTOR_ADAPTADOR` equivalente)
   para máquinas multi-GPU.
7. **`provar_*` self-test**: compilar/probar todos los shaders/encoders
   bajo demanda y devolver nombre→error — ideal como comando Tauri de
   diagnóstico.

## Limitaciones honestas

- Sesión Ghidra efímera: la DB se borra al cerrar; snapshot REA guardado
  en `.tmp-ref/alauk/snapshots/motorcpp.rea-snapshot` (7,8 KB, metadatos;
  reimporta el binario en cada query).
- Decompilación parcial: solo `produzir_pedaco` completa; el resto es
  mapa string↔función + firmas, no pseudocódigo.
- pybind11 ofusca nombres C++ internos; los nombres Python se recuperan
  de docstrings/strings, no de símbolos.
- No se verificó comportamiento en runtime (análisis 100% estático).
