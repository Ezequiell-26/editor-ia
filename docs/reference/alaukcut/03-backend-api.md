# 03 — Backend AlaukCut (57 módulos .pyc + clase Api)

CPython 3.11.9 embebido. Todo el .pyc es bytecode; las firmas se
extrajeron con marshal+dis (ver `anexo-api-completa.txt` — 948 métodos
entre todos los módulos, ~257 expuestos en `Api`).

## Módulos .pyc por dominio

| Módulo | Rol |
|---|---|
| `main.pyc` | Entry point: clase `Api` (RPC), arranque pywebview, DPI, detección de GPU |
| `servidor.pyc` | HTTP server 127.0.0.1 + WS (ver `05-protocolo.md`) |
| `motor_nativo.pyc` | Wrapper Python del `.pyd`: cache de texturas, encoder con autodiagnóstico, GPU por registro Windows |
| `projetos.pyc` | CRUD de proyectos (crear/renombrar/duplicar/cargar/guardar) |
| `midia.pyc` | Medios: importar, miniaturas, religar archivos movidos, picos de audio, extracción de audio, separación de canales |
| `exportar.pyc` + `exportar_av1.pyc` + `exportar_gif.pyc` + `exportar_audio.pyc` + `exportar_cache.pyc` + `formato_saida.pyc` | Pipeline de export por formato (MP4/AV1/GIF/audio) con cache de prerender |
| `gravar_tela.pyc` + `moldura_monitor.pyc` + `cronometro_gravacao.pyc` | Grabación de pantalla/webcam/audio-PC con molduras de monitor |
| `legendas.pyc` + `legendas_srt.pyc` | Subtítulos: whisper.cpp, traducción, formato SRT, timing |
| `fala.pyc` | Evidencias de habla (VAD: respiraciones, silencios, trechos de fala) |
| `espectro.pyc` | Análisis de espectro de audio |
| `audio_limpeza.pyc` | Limpieza de audio (ruido, mejora) |
| `suavizar.pyc` | Suavizado de clips (speed ramp suave?) |
| `rastreio.pyc` | Tracking de objetos/puntos (YuNet+MediaPipe) |
| `sem_fundo.pyc` + `fundo.pyc` + `pessoa.pyc` | Segmentación de persona / fondo (ONNX MediaPipe, packbits) |
| `tracado.pyc` | Trazo/vectorización de imagen a partir de quadros |
| `mascara_pincel.pyc` | Máscara por pincel (puntos, radio, borrar) |
| `hyperframes.pyc` + `hyperframes_complemento.pyc` | Integración Hyperframes (animación HTML→video?) |
| `copia_leve.pyc` | Copia rápida de archivos de video (hardlink/clone?) |
| `cache_render.pyc` + `leitura_rapida.pyc` + `vigia_ffmpeg.pyc` | Cache de render por firma, lectura rápida de medios, watchdog de ffmpeg |
| `luts.pyc` | Gestión de LUTs .cube |
| `stickers.pyc` | Biblioteca de stickers/emoji animados |
| `biblioteca.pyc` | Biblioteca de sonidos (listar/descargar) |
| `agente.pyc` + `agente_stdio.pyc` | Agente IA: conecta Claude/Codex CLI, permisos, traducción a ops |
| `conversa_ia.pyc` | Chat IA (OpenAI-compatible, herramientas) |
| `conversa_terminal.pyc` | Terminal IA integrada (instalar/apuntar CLIs, enviar mensajes) |
| `licenca.pyc` | Licencias, activación, oferta |
| `atualizacao.pyc` | Auto-update |
| `diagnostico.pyc` + `diagnostico_envio.pyc` + `suporte.pyc` + `suporte_*.pyc` | Diagnóstico, envío de logs, soporte, verificadores de chroma/export lento |
| `config.pyc` + `idiomas.pyc` + `raiz.pyc` + `uma_janela.pyc` + `rede_segura.pyc` + `sem_pyav.pyc` + `alfa.pyc` + `binarios.pyc` + `versao_render.pyc` + `previa_dupla.pyc` | Infra: config, i18n, paths, single-instance, red segura, fallback sin PyAV, alpha, binarios, versión de render, preview dual |

## Clase `Api` — superficie RPC agrupada (~257 métodos)

### Proyectos
`projeto_inicial`, `listar_projetos`, `criar_projeto(proporcion,nome)`,
`renomear_projeto`, `duplicar_projeto`, `carregar_projeto`,
`salvar_projeto`, `excluir_projeto`, `midias_organizacao_*`,
`marcadores_*`, `capa_export_*`, `info_sistema`, `url_midia_base`

### Medios
`importar_midias`, `expandir_caminhos`, `caminhos_soltos`,
`midias_sumidas*`, `midias_procurar`, `midia_religar`,
`midia_canais_audio`, `dialogo_religar`, `midia_miniatura_grande`,
`tira_quadros`, `picos_avulso`, `extrair_audio`, `faixas_de_audio`,
`separar_faixas_audio`, `cor_amostras`, `abrir_local_arquivo`,
`timeline_xml_ler`, `importar_srt`, `dialogo_srt`, `dialogo_importar`

### Grabación (screen/webcam/audio PC)
`gravar_disponivel`, `gravar_monitores`, `gravar_dispositivos_audio`,
`gravar_moldura*`, `gravar_som_pc`, `gravar_iniciar(monitor,dispositivo,
modo,camera,cursor,chroma,som_pc)`, `gravar_webcam_*` (disponible, espejo,
desligar, chroma, sugerir, molduras), `gravar_miniatura_recortada`,
`gravar_pausar/retomar/estado/cancelar`, `gravar_escolher_pasta`,
`gravar_encerrar*`, `gravar_espera_*`, `gravar_quadro_espera`,
`gravar_salvar_espera`, `gravar_descartar_espera`,
`captura_escolher_arquivo`, `captura_salvar`

### Exportación
`exportar_stream_*`, `exportar_prores_*`, `exportar_av1_*`,
`exportar_gif_*`, `exportar_audio_*`, `exportar_formatos`,
`exportar_trocar_caixa`, `export_saida_livre`, `pasta_padrao_export`,
`conferir_pasta_export`, `lembrar_pasta_export`, `cancelar_exportacao`,
`abrir_pasta`, `export_marcar`, `progresso_extrair_audio`,
`sincronizar_audio`

### Motor nativo (preview/render por texturas)
`nativo_disponivel`, `codificador_*`, `nativo_iniciar`, `nativo_quadro`,
`nativo_quadros`, `nativo_pedaco_guardar`, `nativo_juntar_audio`,
`nativo_adiantar_som`, `nativo_nova_parte`, `nativo_medir`,
`nativo_finalizar`, `nativo_cancelar`, `nativo_tenho`,
`nativo_esquecer_textura`, `nativo_geracao_texturas`,
`nativo_soltar_texturas`, `nativo_carimbo_inicial`, `nativo_medida_video`,
`nativo_ligado/definir_ligado`, `nativo_previa_*` (iniciar/parar/estado/
janela), `nativo_prova_legenda`, `nativo_descartar_som`,
`nativo_previa_janela_*`, `previa_janela_teste`, `previa_janela_esconder`

### Prerender / cache
`prerender_estado`, `prerender_validos`, `prerender_anotar`,
`prerender_assinaturas`, `prerender_limpar`,
`montagem_iniciar/usar_cache/fim/cancelar`, `leitura_rapida_aguardando`,
`passo_final_andamento`, `versao_render`, `modo_bench`,
`registrar_ambiente`, `janela_no_processador`

### IA en el proyecto
`pessoa_preparar/caminho/progresso` (segmentación persona),
`rastreio_*` (candidatas/rodar/progresso/cancelar),
`fundo_preparar/caminho/progresso`, `sem_fundo`,
`mascara_pincel_rapido`, `tracado_imagem`,
`realce_disponivel`, `limpar_audio`, `remover_fundo`,
`suavizar_clipe`, `progresso_suavizar`, `cancelar_suavizar`,
`reverter_clipe`, `detectar_respiracoes`, `trechos_de_fala`,
`gerar_legendas(progreso/cancelar)`, `salvar_srt`, `garantir_espectro`,
`picos_avulso`, `batidas_analisar`, `tira_quadros`

### Stickers/emoji
`listar_stickers`, `adicionar_sticker`, `emoji_animado_*`

### Sonidos
`listar_sons`, `baixar_som`

### Hyperframes
`hyperframes_*` (listar, renderizar, anexos, complemento instalar/estado)

### Copia leve
`copia_leve_*` (pedir/estado/liga/pausa/conferida/uso/apagar)

### Agente IA (conectar CLIs)
`agente_*` (~20 métodos: estado, ligar/desligar, assistentes,
conectar_claude, conferir, desconectar, testar)

### Conversación IA
`conversa_*` (estado, preferencia, chave_gravar, enviar)

### Terminal IA
`terminal_*` (~14 métodos: estado, apontar, entrar, codigo, instalar,
preferencia, aferir, enviar, andamento, cancelar, trabalho_do_projeto)

### Licencia / updates / soporte
`licenca_*`, `oferta_*`, `atualizacao_*`, `suporte_*`,
`diagnostico_*`, `licencas_terceiros`, `config_*`, `idioma_*`,
`fechar_app`, `alternar_fullscreen`, `copiar_texto`, `abrir_no_navegador`
