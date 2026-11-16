# 04 — Motor nativo `motorcpp.cp311-win_amd64.pyd`

Extensión CPython x86-64 (~900 KB, ~1.888 funciones según Ghidra).
Es el motor de render/captura/codificación. Python lo invoca vía
`motor_nativo.pyc` (wrapper con cache de texturas y autodiagnóstico de GPU).

## Grupos de exports (118 identificados)

### Preview / render por texturas
`previa_desenhar`, `previa_desenhar_na_janela`, `previa_janela_*`
(estado/mostrar/esconder/pintar/provar), `desenhar`, `desenhar_desenho`,
`desenhar_quadro`, `desenhar_ms`, `desenhar_s`, `desenhar_teste`,
`desenhar_e_sincronizar`, `desenho_suportado`, `quadros_desenhados`,
`imagem_prova`, `prova`, `provar_*` (transicoes, textura_reaproveitada,
preso), `prova_teto_cache`, `tex_janela`, `textura`, `texturas`

### Codificación / export nativo
`codificar`, `codificar_lote`, `codificar_planos`, `decodificar_video`,
`ler_e_decodificar`

### Captura de pantalla
`captura`, `captura_iniciar/estado/pausar/retomar/encerrar/cancelar`,
`captura_cursor`, `captura_monitores`, `captura_erro`, `captura_suportada`

### Webcam
`webcam`, `webcam_abrir/cameras/fechar/estado/erro/suportada`,
`webcam_chroma`, `webcam_chroma_sugerir`, `webcam_moldura`,
`webcam_previa_*` (esconder/foto/injetar/mostrar/retangulo/trilha),
`webcam_gravar_*` (iniciar/pausar/retomar/encerrar/cancelar),
`webcam_trilha_de_prova`

### Audio del PC (loopback WAPAPI)
`som_pc_iniciar/pausar/retomar/encerrar/cancelar`, `som_pc_nivel`,
`som_pc_saida`, `som_pc_segundos`

### Audio general
`audio_iniciar/pausar/retomar/encerrar/cancelar`, `audio_nivel`,
`audio_nivel_de_bytes`, `audio_segundos`, `audio_entradas`

### Capability queries (`*_suportado(s)`)
`transicoes_suportadas`, `acabamento_suportado`, `canto_suportado`,
`chroma_suportado`, `cor_suportada`, `desenho_suportado`,
`desfoque_suportado`, `efeitos_suportados`, `empilhado_suportado`,
`formas_suportadas`, `fundo_suportado`, `hsl_suportado`, `isolar_suportado`,
`lut3_suportada`, `manter_suportado`, `mascara_suportada`,
`pessoa_suportada`, `regiao_suportada`, `sem_fundo_suportado`

### Efectos puntuales
`isolar` (aislar voz?), `pessoa`, `transicao`, `transicoes`,
`desenhar_desenho`

## Shaders HLSL (`backend/shaders/`, 2.841 líneas)

| Shader | Líneas | Rol |
|---|---|---|
| `camada.hlsl` | 970 | Compositor de capas — **port pixel-exacto del GLSL de motor.js**; el header documenta las trampas de traducción (ver abajo) |
| `transicao.hlsl` | 1321 | Todas las transiciones en HLSL con helpers `uvExato()`, `ModGLSL` etc. |
| `acabamento.hlsl` | 262 | Post-proceso/finish (vignette, grain, letterbox?) |
| `desfoque.hlsl` | 74 | Blur |
| `isolar.hlsl` | 63 | Aislamiento (voz/fuente?) |
| `regiao.hlsl` | 151 | Efecto por región del frame |

### Lecciones de paridad GLSL→HLSL (documentadas por ellos)

- `mod` de GLSL ≠ `fmod` de HLSL en argumentos negativos → helper `ModGLSL`.
- `fract` → `frac`; `atan(y,x)` → `atan2(y,x)`; `mix` → `lerp`.
- `floor`/`step`/`fract` cuantizan: cualquier efecto que deba ser
  "continuo" (sin escalones de 1 ulp entre GPUs) usa `uvExato()` y evita
  cuantización de celda (comentarios en `transicoes_gl.js`).
- Precisión: WebGL/ANGLE vs D3D11 diffieren; matices de texture origin.
- Matrices row-major vs column-major.

## Encoder (`motor_nativo.pyc`)

- Detecta GPU leyendo registro de Windows (`_placas_do_windows`,
  `_nivel_directx_das_placas`).
- Prueba encoders (NVENC / MediaFoundation / QSV) con renders de prueba;
  marca "placa caída" persistente para no reintentar.
- `codificador_usar_windows`, `codificador_tentar_placa`,
  `codificador_estado`.

## Pipeline de render nativo (inferido de Api + exports)

1. Front describe capas JSON → `nativo_quadro(camadas)` o por lotes
   `nativo_quadros(lote)`.
2. Texturas de vídeo se suben una vez por hash (`nativo_tenho`,
   `nativo_esquecer_textura`, `nativo_geracion_texturas`).
3. Render por partes (`nativo_nova_parte`, `montagem_*`,
   `prerender_*`) con cache por firma (`assinaturas`, `receita`,
   `impressao`) — reusa pedazos si el proyecto no cambió.
4. Audio se adelanta por separado (`nativo_adiantar_som`,
   `nativo_juntar_audio`, `nativo_descartar_som`).
5. `nativo_medir` = benchmark; `nativo_previa_*` = preview en ventana
   nativa (alternativa al WebGL).
