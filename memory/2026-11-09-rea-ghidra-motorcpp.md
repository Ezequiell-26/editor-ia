# 2026-11-09 — REA/Ghidra nivel código: motorcpp.pyd + inventario DLL CapCut

## Qué se hizo

Análisis con REA 6.4.0 + Ghidra 12.1.4 del motor nativo de AlaukCut
(`motorcpp.cp311-win_amd64.pyd`, SHA-256 `47488a8b…f46a`) y nuevo
evidencia de CapCut (inventario de 71 DLLs >500 KB).

## Hallazgos clave (AlaukCut motor)

- **pybind11 v11 MSVC** — no hay PyMethodDef; firmas recuperadas de
  docstrings embebidos.
- Pipeline: decode MF SourceReader con **DXGI device manager** → anillo
  de texturas GPU (`MOTOR_ANEL`, backpressure `esperar_anel_s`) → draw
  HLSL (D3D11) + Direct2D (efectos) + DirectWrite (leyendas) → preview
  Present o encode MF SinkWriter con **`MFCreateDXGISurfaceBuffer` +
  `WriteSample` (cero-copia GPU→encoder)**.
- FOURCCs de salida: H264, HEVC, `apcn` (ProRes 422), `AVdn`.
- Stats por etapa en cada op: `ler_s/desenhar_s/esperar_anel_s/total_s`,
  preview `ler_ms/desenhar_ms/placa_ms/trocar_ms`, percentiles
  `media/mediana/p95/pior_ms`.
- Resiliencia: `DXGI_ERROR_DEVICE_REMOVED 0x887A0005` → `placa_caiu` /
  `reabrir_placa`; hooks `MOTOR_PROVA_PLACA_CAI*`; selección de adaptador
  DXGI + `MOTOR_ADAPTADOR` + `%LOCALAPPDATA%\EditorAlan\placa_escolhida.txt`
  + fallback WARP; cache de texturas por VRAM.
- Capability-query: el front llama `*_suportada(s)`/`provar_*` en vez de
  duplicar listas (transiciones, efectos, chroma, máscara, LUT, webcam,
  codificadores).
- Mapa completo: 340 funciones con strings → `docs/reference/alaukcut/
  anexos-rea/func-strings.txt`; firmas pybind11 → `api-nativa-firmas.txt`;
  pseudocódigo `produzir_pedaco` → `decomp-encoder-open.c`;
  doc narrativa → `docs/reference/alaukcut/09-motor-nativo-ghidra.md`.

## Hallazgos clave (CapCut)

- `videoeditor.dll` (70 MB) **supera el límite REA de 64 MiB** — análisis
  sigue siendo por strings/recursos, no Ghidra completo.
- Pero el inventario de DLLs revela la arquitectura real: **FFmpeg 7.x
  completo** (avcodec-61/avformat-61/avfilter-10/avutil-59/swscale-8) +
  dav1d, SvtAv1Enc, LAME, ByteVC1_dec, ttheif, jxl, libraw +
  **OpenVINO con plugin NPU Intel** + Tracking.dll + audioeffect +
  speechsdk + Lynx UI + CEF + C2PA.
- Documentado en `docs/reference/capcut/01-arquitectura.md`.

## Técnica útil (reusable)

- `rea search` reimporta el binario en cada llamada (~1-4 min); el
  `--snapshot` NO conserva el inventario de strings (devolvió vacío).
- Para xrefs masivos sin pagar Ghidra por query: script propio
  `.tmp-ref/alauk/xref_strings.py` escanea .text por operandos
  RIP-relative y mapea string→función vía `.pdata`. 1.236 strings con
  code-refs, 340 funciones identificadas.
- pybind11: buscar strings `(...) -> tipo` en docstrings = firmas reales.

## Pendiente

- Decompilar funciones concretas de interés (compositor 0x180022270,
  encoder 0x180026e30/0x180027200, selección GPU 0x180031f20) si se
  necesita más detalle — cada `rea decompile` cuesta una reimportación.
- CapCut: para Ghidra real haría falta correr `analyzeHeadless.bat`
  directo sobre `videoeditor.dll` con proyecto propio (sin límite REA)
  o analizar DLLs <64 MB (`audioeffect.dll` 14 MB, `res_pool.dll`,
  `Tracking.dll`, `EffectPlatform.dll`, `DeepAgentsService.dll`).
- Aplicar lecciones a Olyvia: stats por etapa en render-worker,
  capability-query `*_supported`, detector de GPU perdida, adaptador
  fijado por config.
