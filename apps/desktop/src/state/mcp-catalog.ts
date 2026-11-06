/**
 * Catálogo de herramientas MCP.
 *
 * Es la fuente única de `tools/list`: el servidor Rust pide este catálogo a la
 * ventana y lo devuelve tal cual. Agregar una herramienta es agregar una
 * entrada acá y su caso en `executeMcpTool`.
 */

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Pista para el cliente: la herramienta no modifica nada. */
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

const obj = (
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  additionalProperties: false,
  ...(required.length > 0 ? { required: [...required] } : {}),
});

const str = (description?: string) =>
  description ? { type: 'string', description } : { type: 'string' };
const num = (description?: string) =>
  description ? { type: 'number', description } : { type: 'number' };
const boundedNum = (minimum: number, maximum: number, description?: string) => ({
  type: 'number',
  minimum,
  maximum,
  ...(description ? { description } : {}),
});
const boundedInt = (minimum: number, maximum: number, description?: string) => ({
  type: 'integer',
  minimum,
  maximum,
  ...(description ? { description } : {}),
});
const bool = (description?: string) =>
  description ? { type: 'boolean', description } : { type: 'boolean' };

const READ = 'Sólo lectura.';
const WRITE = 'Modifica el proyecto (se puede deshacer con undo).';

const RAW_MCP_TOOLS: readonly McpToolDefinition[] = [
  // ── Estado y lectura ────────────────────────────────────────────────
  {
    name: 'diagnostics',
    description:
      'Estado completo del editor: versión, proyecto, proveedor activo, plugins y cantidad de herramientas. Sin secretos.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'app_status',
    description: `${READ} Si hay proyecto abierto y cuál.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'project_summary',
    description: `${READ} Formato, fps, duración, pistas, clips, subtítulos y assets.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'project_snapshot',
    description: `${READ} Fotografía consolidada del proyecto en una llamada: resumen, pistas, clips, subtítulos, medios, marcadores y perfiles. Admite secciones y límite por sección.`,
    inputSchema: obj({
      include: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        uniqueItems: true,
        items: { type: 'string', enum: ['tracks', 'clips', 'captions', 'assets', 'markers', 'profiles'] },
        description: 'Secciones a incluir. Si se omite, incluye todas.',
      },
      limit: boundedNum(1, 500, 'Máximo de elementos por sección (1–500; por defecto 200).'),
    }),
  },
  {
    name: 'timeline_clips',
    description: `${READ} Clips con id, pista, tipo, inicio, duración, motion y ganancia.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'captions_list',
    description: `${READ} Subtítulos con id, tiempos, texto y hablante.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'assets_list',
    description: `${READ} Medios del proyecto con id, tipo, ruta y metadatos.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tracks_list',
    description: `${READ} Pistas con id, tipo, nombre, bloqueo, silencio y cantidad de clips.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export_profiles',
    description: `${READ} Perfiles de exportación con formato, resolución y bitrate.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },

  // ── Proyecto ────────────────────────────────────────────────────────
  {
    name: 'project_new',
    description: `${WRITE} Crea un proyecto nuevo (descarta el abierto si no está guardado).`,
    inputSchema: obj(
      {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        width: boundedInt(2, 7680, 'por defecto 1920; máximo 7680'),
        height: boundedInt(2, 4320, 'por defecto 1080; máximo 4320'),
        fps: boundedNum(1, 240, 'por defecto 30; máximo 240'),
      },
      ['name'],
    ),
  },
  {
    name: 'project_open',
    description: 'Abre un proyecto desde una ruta absoluta.',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
  },
  {
    name: 'project_save',
    description: 'Guarda el proyecto abierto.',
    inputSchema: obj({}),
  },
  {
    name: 'project_save_as',
    description: 'Guarda el proyecto con otro nombre.',
    inputSchema: obj({}),
  },
  {
    name: 'project_close',
    description: 'Cierra el proyecto abierto.',
    inputSchema: obj({}),
  },
  {
    name: 'undo',
    description: 'Deshace el último cambio.',
    inputSchema: obj({}),
  },
  {
    name: 'redo',
    description: 'Rehace el último cambio deshecho.',
    inputSchema: obj({}),
  },

  // ── Pistas ──────────────────────────────────────────────────────────
  {
    name: 'track_add',
    description: `${WRITE} Agrega una pista (video, audio, narration, graphic, image, adjustment).`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['video', 'audio', 'narration', 'graphic', 'image', 'adjustment'] },
      label: { type: 'string', maxLength: 120 },
    }, ['kind']),
  },
  {
    name: 'track_update',
    description: `${WRITE} Cambia nombre, bloqueo, silencio u ocultamiento de una pista.`,
    inputSchema: {
      ...obj(
        {
          trackId: { type: 'string', minLength: 1, maxLength: 256 },
          label: { type: 'string', maxLength: 120 },
          locked: bool(),
          muted: bool(),
          hidden: bool(),
        },
        ['trackId'],
      ),
      minProperties: 2,
    },
  },
  {
    name: 'track_delete',
    description: `${WRITE} Borra una pista vacía.`,
    inputSchema: obj({ trackId: { type: 'string', minLength: 1, maxLength: 256 } }, ['trackId']),
  },

  // ── Clips ───────────────────────────────────────────────────────────
  {
    name: 'clip_add',
    description: `${WRITE} Agrega un medio a la timeline.`,
    inputSchema: obj(
      {
        assetId: { type: 'string', minLength: 1, maxLength: 256 },
        atFrame: boundedInt(0, 10_000_000),
        durationFrames: boundedInt(1, 10_000_000),
        trackId: { type: 'string', minLength: 1, maxLength: 256 },
      },
      ['assetId'],
    ),
  },
  {
    name: 'clip_update',
    description: `${WRITE} Etiqueta, habilitado, ganancia o movimiento de un clip.`,
    inputSchema: {
      ...obj(
        {
          clipId: { type: 'string', minLength: 1, maxLength: 256 },
          label: { type: 'string', maxLength: 200 },
          enabled: bool(),
          gainDb: boundedNum(-60, 24),
          motion: {
            type: ['string', 'null'],
            enum: ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', null],
          },
          motionIntensity: boundedNum(0, 1),
        },
        ['clipId'],
      ),
      minProperties: 2,
    },
  },
  {
    name: 'clip_move',
    description: `${WRITE} Mueve un clip a un frame y, opcionalmente, a otra pista.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      startFrame: boundedInt(0, 10_000_000),
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['clipId', 'startFrame']),
  },
  {
    name: 'clip_split',
    description: `${WRITE} Divide un clip en un frame.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      atFrame: boundedInt(1, 10_000_000),
    }, ['clipId', 'atFrame']),
  },
  {
    name: 'clip_delete',
    description: `${WRITE} Elimina un clip.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'clip_effects',
    description: `${WRITE} Velocidad o reproducción inversa de un clip.`,
    inputSchema: {
      ...obj({
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        speed: boundedNum(0.1, 4, '1 = normal; rango 0.1–4'),
        reverse: bool(),
      }, ['clipId']),
      minProperties: 2,
    },
  },

  // ── Subtítulos ──────────────────────────────────────────────────────
  {
    name: 'caption_add',
    description: `${WRITE} Agrega un subtítulo.`,
    inputSchema: obj(
      {
        text: { type: 'string', minLength: 1, maxLength: 2_000 },
        startFrame: boundedInt(0, 10_000_000),
        durationFrames: boundedInt(1, 10_000_000),
      },
      ['text', 'startFrame', 'durationFrames'],
    ),
  },
  {
    name: 'caption_update',
    description: `${WRITE} Cambia texto o tiempos de un subtítulo.`,
    inputSchema: {
      ...obj({
        cueId: { type: 'string', minLength: 1, maxLength: 256 },
        text: { type: 'string', minLength: 1, maxLength: 2_000 },
        startFrame: boundedInt(0, 10_000_000),
        endFrame: boundedInt(1, 10_000_000),
      }, ['cueId']),
      minProperties: 2,
    },
  },
  {
    name: 'caption_delete',
    description: `${WRITE} Elimina un subtítulo.`,
    inputSchema: obj({ cueId: { type: 'string', minLength: 1, maxLength: 256 } }, ['cueId']),
  },
  {
    name: 'diarize',
    description: `${WRITE} Etiqueta hablantes en los subtítulos con el proveedor configurado.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      prefix: bool(),
      language: { type: 'string', maxLength: 32 },
    }, ['clipId']),
  },

  // ── Audio ───────────────────────────────────────────────────────────
  {
    name: 'audio_mix',
    description: `${WRITE} Ganancia master, limitador y objetivo de loudness.`,
    inputSchema: {
      ...obj({
        masterGainDb: boundedNum(-60, 12),
        masterLimiter: bool(),
        targetLufs: boundedNum(-33, -9),
      }),
      minProperties: 1,
    },
  },

  // ── Automatización y calidad ────────────────────────────────────────
  {
    name: 'run_automation',
    description: `${WRITE} cut_silences, cut_pauses, auto_cleanup, auto_pilot o export.`,
    inputSchema: obj(
      {
        kind: {
          type: 'string',
          enum: ['cut_silences', 'cut_pauses', 'auto_cleanup', 'auto_pilot', 'export'],
        },
        outputDir: { type: 'string', maxLength: 32_768 },
        profileId: { type: 'string', maxLength: 256 },
      },
      ['kind'],
    ),
  },
  {
    name: 'critic_run',
    description: `${READ} Evalúa la edición: puntaje y hallazgos con severidad.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'critic_fix',
    description: `${WRITE} Aplica los arreglos automáticos del crítico.`,
    inputSchema: obj({
      rules: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 120 },
      },
    }),
  },
  {
    name: 'export_render',
    description: 'Renderiza y verifica el MP4 de entrega.',
    inputSchema: obj({
      outputDir: { type: 'string', maxLength: 32_768 },
      profileId: { type: 'string', maxLength: 256 },
      qualityCheck: bool(),
    }),
  },
  {
    name: 'export_interchange',
    description: 'Exporta EDL, OTIO o FCPXML para otro editor.',
    inputSchema: obj(
      {
        format: { type: 'string', enum: ['edl', 'otio', 'fcpxml'] },
        directory: { type: 'string', minLength: 1, maxLength: 32_768 },
      },
      ['format', 'directory'],
    ),
  },

  // ── Multicámara y fábrica ───────────────────────────────────────────
  {
    name: 'multicam_build',
    description: `${WRITE} Arma el corte multicámara en una pista nueva (por voz o con cortes dados).`,
    inputSchema: obj(
      {
        assetIds: {
          type: 'array',
          minItems: 2,
          maxItems: 16,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        offsets: {
          type: 'object',
          description: 'offsetFrames no negativos por assetId',
          additionalProperties: { type: 'number', minimum: 0, maximum: 10_000_000 },
        },
        autoCut: bool('por defecto true'),
      },
      ['assetIds'],
    ),
  },
  {
    name: 'factory_run',
    description:
      'Encola un video completo desde un brief y devuelve jobId inmediatamente. Consulta factory_job_status/factory_job_list y solicita cancelación con factory_job_cancel.',
    inputSchema: obj(
      {
        brief: { type: 'string', minLength: 10, maxLength: 4_000 },
        outputDir: { type: 'string', maxLength: 32_768 },
        scenes: boundedInt(1, 12, '1–12'),
        width: boundedInt(2, 7680),
        height: boundedInt(2, 4320),
        language: { type: 'string', minLength: 2, maxLength: 12 },
        render: bool(),
      },
      ['brief'],
    ),
  },
  {
    name: 'factory_job_status',
    description: `${READ} Consulta etapa, progreso, registro, errores y rutas de salida de un trabajo de fábrica.`,
    inputSchema: obj({ jobId: { type: 'string', minLength: 1, maxLength: 128 } }, ['jobId']),
  },
  {
    name: 'factory_job_list',
    description: `${READ} Lista trabajos de fábrica recientes, incluidos en cola, activos, completados e interrumpidos.`,
    inputSchema: obj({ limit: boundedInt(1, 50, '1–50; por defecto 20.') }),
  },
  {
    name: 'factory_job_cancel',
    description: 'Solicita cancelar un trabajo. Es cooperativo: respeta la operación de escritura/render que ya esté en curso.',
    inputSchema: obj({ jobId: { type: 'string', minLength: 1, maxLength: 128 } }, ['jobId']),
  },

  // ── Estilos y herramientas ──────────────────────────────────────────
  {
    name: 'caption_style_update',
    description: `${WRITE} Cambia tipografía, tamaño y colores de un estilo de subtítulo.`,
    inputSchema: {
      ...obj(
        {
          styleId: { type: 'string', minLength: 1, maxLength: 256 },
          name: { type: 'string', maxLength: 120 },
          fontFamily: { type: 'string', maxLength: 120 },
          fontSizePx: boundedNum(8, 300),
          color: { type: 'string', maxLength: 32 },
          outlineColor: { type: 'string', maxLength: 32 },
          backgroundColor: { type: 'string', maxLength: 32 },
        },
        ['styleId'],
      ),
      minProperties: 2,
    },
  },
  {
    name: 'settings_set_tools',
    description: 'Fija las rutas de FFmpeg y FFprobe (valida que existan).',
    inputSchema: {
      ...obj({
        ffmpeg: { type: 'string', minLength: 1, maxLength: 32_768 },
        ffprobe: { type: 'string', minLength: 1, maxLength: 32_768 },
      }),
      minProperties: 1,
    },
  },

  {
    name: 'extract_audio',
    description: 'Extrae la primera pista de audio sin recodificar; elige m4a o mka según el códec.',
    inputSchema: obj({
      input: { type: 'string', minLength: 1, maxLength: 32_768 },
      output: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['input', 'output']),
  },
  {
    name: 'write_chapters',
    description: 'Escribe capítulos y título en una copia del archivo, sin recodificar.',
    inputSchema: obj(
      {
        input: { type: 'string', minLength: 1, maxLength: 32_768 },
        output: { type: 'string', minLength: 1, maxLength: 32_768 },
        title: { type: 'string', maxLength: 200 },
        chapters: {
          type: 'array',
          minItems: 1,
          maxItems: 80,
          items: obj({
            startSeconds: boundedNum(0, 86_400),
            endSeconds: boundedNum(0, 86_400),
            title: { type: 'string', minLength: 1, maxLength: 200 },
          }),
        },
      },
      ['input', 'output', 'chapters'],
    ),
  },
  {
    name: 'remux',
    description: 'Cambia el contenedor (mp4, mkv, mov, webm) sin recodificar.',
    inputSchema: obj({
      input: { type: 'string', minLength: 1, maxLength: 32_768 },
      output: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['input', 'output']),
  },
  {
    name: 'export_lossless',
    description:
      'Corta un rango de un archivo sin recodificar (segundos). Devuelve duración real y corrimiento por keyframe.',
    inputSchema: obj(
      {
        input: { type: 'string', minLength: 1, maxLength: 32_768, description: 'ruta absoluta del archivo' },
        output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'ruta absoluta de salida' },
        startSeconds: boundedNum(0, 86_400),
        endSeconds: boundedNum(0, 86_400),
        exact: bool('recodifica el rango para un corte exacto'),
      },
      ['input', 'output', 'startSeconds', 'endSeconds'],
    ),
  },

  // ── Medios ──────────────────────────────────────────────────────────
  {
    name: 'asset_import',
    description: `${WRITE} Importa archivos del disco al proyecto (rutas absolutas).`,
    inputSchema: obj({
      paths: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { type: 'string', minLength: 1, maxLength: 32_768 },
      },
    }, ['paths']),
  },
  {
    name: 'asset_remove',
    description: `${WRITE} Quita un medio del proyecto (no borra el archivo).`,
    inputSchema: obj({ assetId: { type: 'string', minLength: 1, maxLength: 256 } }, ['assetId']),
  },
  {
    name: 'media_folder_list',
    description: `${READ} Explora una carpeta de la PC y devuelve los archivos de medios (imagen, audio, video) con ruta absoluta, nombre, tipo y tamaño. Acepta una ruta absoluta o el nombre de una carpeta dentro de Descargas. Recorre hasta dos niveles de subcarpetas (máx. 300 archivos). Usala antes de asset_import para descubrir material disponible.`,
    inputSchema: obj({
      folder: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de la carpeta o su nombre dentro de Descargas.' },
      root: { type: 'string', maxLength: 32_768, description: 'Carpeta base alternativa donde buscar por nombre (opcional).' },
    }, ['folder']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_list',
    description: `${READ} Lista TODO el contenido de una carpeta de la PC (subcarpetas primero, después archivos) con ruta absoluta, tipo (dir/image/audio/video/subtitle/text/other) y tamaño. No recursa: bajá nivel por nivel. Tope 500 entradas. Usala para explorar el disco antes de importar o abrir archivos.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de la carpeta a listar.' },
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_read',
    description: `${READ} Lee el contenido de texto de un archivo de la PC (subtítulos, proyectos .editoria.json, CSV, etc.). Devuelve el texto completo hasta 512 KiB; si es más grande viene truncado. No interpreta binarios.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo a leer.' },
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_write',
    description: `${WRITE} Escribe texto en un archivo de la PC (lo crea si no existe, junto con las carpetas padre). Sirve para guiones, subtítulos, scripts, JSON de proyecto, configs — cualquier texto hasta 10 MiB.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo a escribir.' },
      content: { type: 'string', maxLength: 10_485_760, description: 'Contenido de texto a escribir.' },
    }, ['path', 'content']),
  },
  {
    name: 'fs_mkdir',
    description: `${WRITE} Crea una carpeta en la PC (con todas las carpetas padre por defecto).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de la carpeta a crear.' },
      recursive: { type: 'boolean', description: 'Crear también las carpetas padre (por defecto true).' },
    }, ['path']),
  },
  {
    name: 'fs_delete',
    description: `${WRITE} Borra un archivo o carpeta de la PC. Las carpetas con contenido exigen recursive=true explícito. Rechaza rutas protegidas (raíz de unidad, Windows, Program Files).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta a borrar.' },
      recursive: { type: 'boolean', description: 'Borrar carpetas con contenido (por defecto false).' },
    }, ['path']),
  },
  {
    name: 'fs_move',
    description: `${WRITE} Mueve o renombra un archivo/carpeta de la PC a otra ruta. El destino no debe existir (no sobrescribe); puede cruzar carpetas del mismo disco.`,
    inputSchema: obj({
      from: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de origen.' },
      to: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de destino.' },
    }, ['from', 'to']),
  },
  {
    name: 'voice_isolation_status',
    description: `${READ} Estado del motor de aislación de voz (Demucs): si hay un Python con torch+demucs instalado y el motivo cuando no.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'voice_isolate',
    description: `${WRITE} Aísla la voz de un archivo de audio/video del disco con Demucs local y devuelve la ruta del stem vocals.wav (más accompaniment.wav). Requiere Python con demucs; la primera vez descarga el modelo (~2 GB). La operación es lenta: usala una vez por material y reutilizá el resultado.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio o video.' },
      model: { type: 'string', maxLength: 64, description: 'Modelo Demucs (por defecto htdemucs).' },
      quality: { type: 'string', enum: ['low', 'medium', 'high', 'best'], description: 'Calidad vs velocidad (por defecto medium).' },
    }, ['path']),
  },
  {
    name: 'voice_isolation_prepare',
    description: `${WRITE} Genera (o reutiliza) el stem vocals.wav de un asset de audio/video DEL PROYECTE ABIERTO en media/isolation/<assetId>/. Los clips con audio.voiceIsolation.enabled lo usan automáticamente al exportar. Requiere Python con demucs; la primera vez descarga el modelo (~2 GB).`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256, description: 'Id del asset del proyecto (ver assets_list).' },
      quality: { type: 'string', enum: ['low', 'medium', 'high', 'best'], description: 'Calidad vs velocidad (por defecto medium).' },
      force: { type: 'boolean', description: 'Regenera el stem aunque ya exista.' },
    }, ['assetId']),
  },
  {
    name: 'flow_browser_status',
    description: `${READ} Estado del navegador dedicado de la app (Chrome/Edge real con perfil propio y CDP en 127.0.0.1): si está instalado, corriendo y su endpoint de depuración.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'flow_browser_launch',
    description: `${WRITE} Lanza el navegador dedicado de la app (Chrome/Edge real, perfil persistente en LOCALAPPDATA\\Olyvia, CDP en 127.0.0.1) y abre una URL (por defecto https://flow.google.com). La sesión de Google persiste entre ejecuciones. Para controlar la página usá un servidor MCP tipo Playwright con --cdp-endpoint <cdpUrl>.`,
    inputSchema: obj({
      url: { type: 'string', maxLength: 2_048, description: 'URL http(s) a abrir (por defecto flow.google.com).' },
    }),
  },
  {
    name: 'flow_browser_stop',
    description: `${WRITE} Cierra el navegador dedicado lanzado por la app.`,
    inputSchema: obj({}),
  },
  {
    name: 'flow_embed_status',
    description: `${READ} Estado del navegador embebido de Olyvia (ventana propia con WebView2 y CDP en 127.0.0.1): si está abierto, qué URL muestra y su endpoint de depuración. Para ver TODAS las sesiones web abiertas usá web_sessions_status.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'flow_embed_open',
    description: `${WRITE} Abre (o reutiliza) una sesión del navegador embebido de Olyvia y navega a una URL http(s). Por defecto abre Flow (slot "flow", https://flow.google.com); con «slot» abre cualquier otra web en su propia ventana (varias webs activas a la vez, cada una con su CDP). Úsala para que el usuario inicie sesión dentro de la app. Si Google rechaza el login en webviews, usá flow_browser_launch (Chrome real por CDP) como alternativa.`,
    inputSchema: obj({
      url: { type: 'string', maxLength: 2_048, description: 'URL http(s) a abrir (por defecto flow.google.com para el slot flow).' },
      slot: { type: 'string', maxLength: 32, description: 'Nombre de la sesión web (1-32 chars, letras/números/-/_). Por defecto "flow".' },
    }),
  },
  {
    name: 'web_sessions_status',
    description: `${READ} Lista todas las sesiones del navegador embebido abiertas (nombre, URL y endpoint CDP de cada una).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'flow_embed_close',
    description: `${WRITE} Cierra una sesión del navegador embebido de Olyvia (por defecto Flow; indicá «slot» para otra).`,
    inputSchema: obj({
      slot: { type: 'string', maxLength: 32, description: 'Sesión a cerrar (por defecto "flow").' },
    }),
  },
  {
    name: 'flow_embed_nav',
    description: `${WRITE} Navegación histórica de una sesión del navegador embebido: back, forward o reload (por defecto Flow; «slot» para otra).`,
    inputSchema: obj({
      direction: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'Dirección de navegación.' },
      slot: { type: 'string', maxLength: 32, description: 'Sesión (por defecto "flow").' },
    }, ['direction']),
  },
  {
    name: 'flow_embed_eval',
    description: `${WRITE} Ejecuta JavaScript en la página de una sesión del navegador embebido y devuelve el resultado serializado (JSON; «slot» para elegir sesión, por defecto Flow). Para control completo (clicks, screenshots, descargas) usá el endpoint CDP de web_sessions_status con un cliente CDP/Playwright.`,
    inputSchema: obj({
      js: { type: 'string', maxLength: 65_536, description: 'Código JavaScript a evaluar en la página.' },
      slot: { type: 'string', maxLength: 32, description: 'Sesión (por defecto "flow").' },
    }, ['js']),
  },

  // ── Marcadores ──────────────────────────────────────────────────────
  {
    name: 'markers_list',
    description: `${READ} Marcadores con id, frame, etiqueta y color.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'marker_add',
    description: `${WRITE} Agrega un marcador en un frame.`,
    inputSchema: obj({ frame: boundedInt(0, 10_000_000), label: { type: 'string', maxLength: 200 }, endFrame: boundedInt(0, 10_000_000) }, ['frame']),
  },
  {
    name: 'marker_delete',
    description: `${WRITE} Borra un marcador.`,
    inputSchema: obj({ markerId: { type: 'string', minLength: 1, maxLength: 256 } }, ['markerId']),
  },

  // ── Ajustes y paquete ───────────────────────────────────────────────
  {
    name: 'settings_get',
    description: `${READ} Proveedor de IA y de diarización configurados (sin claves).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'settings_set',
    description: 'Configura el proveedor de IA y/o el de diarización. La clave va al almacén de Windows.',
    inputSchema: {
      ...obj({
        ai: obj({
          kind: { type: 'string', enum: ['mock', 'openai-compatible'] },
          baseUrl: { type: 'string', maxLength: 2_048 },
          model: { type: 'string', maxLength: 256 },
          apiKey: { type: 'string', maxLength: 8_192 },
        }),
        diarize: obj({
          kind: { type: 'string', maxLength: 64 },
          baseUrl: { type: 'string', maxLength: 2_048 },
          language: { type: 'string', maxLength: 32 },
          apiKey: { type: 'string', maxLength: 8_192 },
        }),
      }),
      minProperties: 1,
      maxProperties: 2,
    },
  },
  {
    name: 'package_project',
    description: 'Empaqueta el proyecto y sus medios en un ZIP.',
    inputSchema: obj({}),
  },

  // ── Revisión por ítem ───────────────────────────────────────────────
  {
    name: 'review_build',
    description: `${READ} Arma la lista de decisiones automáticas (silencios, pausas, ruido, zoom, nivel).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'review_apply',
    description: `${WRITE} Aplica sólo los ítems aceptados de la revisión.`,
    inputSchema: obj({
      accepted: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 256 },
      },
    }, ['accepted']),
  },

  // ── Interfaz ────────────────────────────────────────────────────────
  {
    name: 'navigate',
    description: 'Abre una vista de la app.',
    inputSchema: obj({ view: { type: 'string', minLength: 1, maxLength: 80 } }, ['view']),
  },
  {
    name: 'playhead',
    description: 'Mueve el cabezal de reproducción.',
    inputSchema: obj({ frame: boundedInt(0, 10_000_000) }, ['frame']),
  },
  {
    name: 'run_command',
    description: 'Ejecuta un comando del editor en lenguaje natural.',
    inputSchema: obj({ command: { type: 'string', minLength: 1, maxLength: 2_000 } }, ['command']),
  },

  // ── Efectos visuales ────────────────────────────────────────────────
  {
    name: 'clip_effects_apply',
    description: `${WRITE} Aplica o modifica efectos visuales en un clip (brillo, contraste, saturación, temperatura, sombras, altas luces).`,
    inputSchema: {
      ...obj({
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        brightness: boundedNum(-1, 1, 'Ajuste de brillo'),
        contrast: boundedNum(0, 3, 'Contraste (1 = normal)'),
        saturation: boundedNum(0, 3, 'Saturación (1 = normal)'),
        temperature: boundedNum(-1, 1, 'Temperatura de color'),
        shadows: boundedNum(-1, 1, 'Sombras (-1 oscurecer, 1 aclarar)'),
        highlights: boundedNum(-1, 1, 'Altas luces'),
        fade: boundedNum(0, 1, 'Desvanecimiento (0-1)'),
      }, ['clipId']),
      minProperties: 2,
    },
  },
  {
    name: 'clip_effects_clear',
    description: `${WRITE} Limpia todos los efectos visuales de un clip.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'clip_effects_preset',
    description: `${WRITE} Aplica un preset de efectos a un clip (cinematic, vintage, vibrant, warm, cool, bw).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        preset: { type: 'string', enum: ['cinematic', 'vintage', 'vibrant', 'warm', 'cool', 'bw', 'natural'] },
      },
      ['clipId', 'preset'],
    ),
  },

  // ── Transiciones ────────────────────────────────────────────────────
  {
    name: 'transition_add',
    description: `${WRITE} Agrega una transición entre dos clips contiguos.`,
    inputSchema: obj(
      {
        fromClipId: { type: 'string', minLength: 1, maxLength: 256 },
        toClipId: { type: 'string', minLength: 1, maxLength: 256 },
        type: { type: 'string', enum: ['fade', 'dissolve', 'wipe-left', 'wipe-right', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out'] },
        durationFrames: boundedInt(1, 120, 'Duración en frames (por defecto 20)'),
      },
      ['fromClipId', 'toClipId', 'type'],
    ),
  },
  {
    name: 'transition_remove',
    description: `${WRITE} Elimina la transición de un clip.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'transitions_list',
    description: `${READ} Lista todas las transiciones activas en la timeline.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },

  // ── Texto y gráficos ────────────────────────────────────────────────
  {
    name: 'text_layer_add',
    description: `${WRITE} Agrega una capa de texto a la timeline.`,
    inputSchema: obj(
      {
        text: { type: 'string', minLength: 1, maxLength: 500 },
        startFrame: boundedInt(0, 10_000_000),
        durationFrames: boundedInt(1, 10_000_000),
        fontFamily: { type: 'string', maxLength: 120 },
        fontSize: boundedInt(12, 300),
        color: { type: 'string', maxLength: 32 },
        positionX: boundedNum(0, 1, 'Posición X normalizada (0-1)'),
        positionY: boundedNum(0, 1, 'Posición Y normalizada (0-1)'),
        animation: { type: 'string', enum: ['none', 'fade-in', 'fade-out', 'slide-up', 'slide-down', 'typewriter'] },
      },
      ['text', 'startFrame', 'durationFrames'],
    ),
  },
  {
    name: 'text_layer_update',
    description: `${WRITE} Modifica el contenido, estilo o posición de una capa de texto.`,
    inputSchema: {
      ...obj({
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        text: { type: 'string', minLength: 1, maxLength: 500 },
        fontFamily: { type: 'string', maxLength: 120 },
        fontSize: boundedInt(12, 300),
        color: { type: 'string', maxLength: 32 },
        positionX: boundedNum(0, 1),
        positionY: boundedNum(0, 1),
      }, ['clipId']),
      minProperties: 2,
    },
  },
  {
    name: 'lower_third_add',
    description: `${WRITE} Agrega un lower third (título y subtítulo) profesional.`,
    inputSchema: obj(
      {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        subtitle: { type: 'string', maxLength: 200 },
        startFrame: boundedInt(0, 10_000_000),
        durationFrames: boundedInt(30, 600, 'Duración típica: 90-180 frames'),
        style: { type: 'string', enum: ['minimal', 'bar', 'box', 'modern', 'elegant'] },
        position: { type: 'string', enum: ['lower-left', 'lower-right', 'lower-center', 'upper-left', 'upper-right'] },
      },
      ['title', 'startFrame', 'durationFrames'],
    ),
  },

  // ── Operaciones en lote ─────────────────────────────────────────────
  {
    name: 'batch_clips_select',
    description: `${READ} Selecciona clips por tipo, pista o etiqueta para operaciones en lote.`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['video', 'audio', 'image', 'graphic'] },
      trackId: { type: 'string', maxLength: 256 },
      tag: { type: 'string', maxLength: 120 },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'batch_effects_apply',
    description: `${WRITE} Aplica el mismo efecto visual a múltiples clips.`,
    inputSchema: obj(
      {
        clipIds: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        effect: { type: 'string', enum: ['brightness', 'contrast', 'saturation', 'temperature'] },
        value: num(),
      },
      ['clipIds', 'effect', 'value'],
    ),
  },
  {
    name: 'batch_audio_normalize',
    description: `${WRITE} Normaliza el volumen de múltiples clips al mismo nivel.`,
    inputSchema: obj(
      {
        clipIds: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        targetLufs: boundedNum(-33, -9, 'Nivel objetivo en LUFS'),
      },
      ['clipIds', 'targetLufs'],
    ),
  },
  {
    name: 'batch_transitions_add',
    description: `${WRITE} Agrega transiciones entre todos los clips consecutivos de una pista.`,
    inputSchema: obj(
      {
        trackId: { type: 'string', minLength: 1, maxLength: 256 },
        type: { type: 'string', enum: ['fade', 'dissolve', 'wipe-left', 'wipe-right'] },
        durationFrames: boundedInt(5, 60, 'Duración de cada transición'),
      },
      ['trackId', 'type'],
    ),
  },
  {
    name: 'batch_speed_change',
    description: `${WRITE} Cambia la velocidad de múltiples clips.`,
    inputSchema: obj(
      {
        clipIds: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        speed: boundedNum(0.1, 4, 'Velocidad (1 = normal)'),
      },
      ['clipIds', 'speed'],
    ),
  },

  // ── Keyframes y animación ───────────────────────────────────────────
  {
    name: 'keyframe_add',
    description: `${WRITE} Agrega un keyframe a una propiedad de clip (position, scale, rotation, opacity).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        frame: boundedInt(0, 10_000_000, 'Frame relativo al inicio del clip'),
        property: { type: 'string', enum: ['offsetX', 'offsetY', 'scale', 'rotationDeg', 'opacity'] },
        value: num('Valor de la propiedad'),
        easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
      },
      ['clipId', 'frame', 'property', 'value'],
    ),
  },
  {
    name: 'animation_preset_apply',
    description: `${WRITE} Aplica un preset de animación a un clip (zoom-in, pan-left, fade-in-out).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        preset: { type: 'string', enum: ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'fade-in-out', 'rotate'] },
        intensity: boundedNum(0.1, 1, 'Intensidad del efecto (0.1-1)'),
      },
      ['clipId', 'preset'],
    ),
  },

  // ── Audio avanzado ──────────────────────────────────────────────────
  {
    name: 'audio_effect_eq',
    description: `${WRITE} Aplica ecualización de 3 bandas a un clip de audio.`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        lowDb: boundedNum(-12, 12, 'Bajos (graves)'),
        midDb: boundedNum(-12, 12, 'Medios'),
        highDb: boundedNum(-12, 12, 'Altos (agudos)'),
      },
      ['clipId'],
    ),
  },
  {
    name: 'audio_effect_voice',
    description: `${WRITE} Aplica efecto de voz a un clip (deep, chipmunk, robot, echo, cave, radio).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        effect: { type: 'string', enum: ['deep', 'chipmunk', 'robot', 'echo', 'cave', 'radio'] },
      },
      ['clipId', 'effect'],
    ),
  },
  {
    name: 'audio_ducking',
    description: `${WRITE} Aplica ducking automático: baja el volumen de música cuando hay voz.`,
    inputSchema: obj(
      {
        musicTrackId: { type: 'string', minLength: 1, maxLength: 256 },
        voiceTrackId: { type: 'string', minLength: 1, maxLength: 256 },
        reductionDb: boundedNum(-24, -3, 'Cuánto bajar la música (dB)'),
        fadeMs: boundedInt(50, 1000, 'Tiempo de fade (milisegundos)'),
      },
      ['musicTrackId', 'voiceTrackId'],
    ),
  },

  // ── Color grading profesional ───────────────────────────────────────
  {
    name: 'color_wheels_adjust',
    description: `${WRITE} Ajusta color wheels (lift/gamma/gain/offset) para grading profesional.`,
    inputSchema: {
      ...obj({
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        lift: obj({ r: boundedNum(-1, 1), g: boundedNum(-1, 1), b: boundedNum(-1, 1) }),
        gamma: obj({ r: boundedNum(-1, 1), g: boundedNum(-1, 1), b: boundedNum(-1, 1) }),
        gain: obj({ r: boundedNum(-1, 1), g: boundedNum(-1, 1), b: boundedNum(-1, 1) }),
        offset: obj({ r: boundedNum(-1, 1), g: boundedNum(-1, 1), b: boundedNum(-1, 1) }),
      }, ['clipId']),
      minProperties: 2,
    },
  },
  {
    name: 'color_preset_cinematic',
    description: `${WRITE} Aplica un preset de color grading cinematográfico.`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        preset: { type: 'string', enum: ['teal-orange', 'bleach-bypass', 'film-noir', 'golden-hour', 'cold-blue', 'warm-sunset'] },
        intensity: boundedNum(0, 1, 'Intensidad del preset (0-1)'),
      },
      ['clipId', 'preset'],
    ),
  },

  // ── Timeline avanzada ───────────────────────────────────────────────
  {
    name: 'timeline_ripple_delete',
    description: `${WRITE} Elimina clip(s) y cierra el gap automáticamente.`,
    inputSchema: obj(
      {
        clipIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
      ['clipIds'],
    ),
  },
  {
    name: 'timeline_gaps_remove',
    description: `${WRITE} Elimina todos los gaps entre clips en una pista.`,
    inputSchema: obj({ trackId: { type: 'string', minLength: 1, maxLength: 256 } }, ['trackId']),
  },
  {
    name: 'timeline_align_clips',
    description: `${WRITE} Alinea múltiples clips a un punto de referencia.`,
    inputSchema: obj(
      {
        clipIds: {
          type: 'array',
          minItems: 2,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        alignTo: { type: 'string', enum: ['start', 'end', 'center'] },
        referenceFrame: boundedInt(0, 10_000_000),
      },
      ['clipIds', 'alignTo'],
    ),
  },
];

const READ_ONLY_TOOL_NAMES = new Set([
  'diagnostics',
  'app_status',
  'project_summary',
  'project_snapshot',
  'timeline_clips',
  'captions_list',
  'assets_list',
  'tracks_list',
  'export_profiles',
  'critic_run',
  'factory_job_status',
  'factory_job_list',
  'markers_list',
  'settings_get',
  'review_build',
]);

// Estas operaciones crean un elemento o un archivo nuevo sin reemplazar el
// contenido existente del proyecto. El resto de las escrituras se marca con
// destructiveHint=true de forma conservadora.
const ADDITIVE_TOOL_NAMES = new Set([
  'track_add',
  'clip_add',
  'caption_add',
  'asset_import',
  'marker_add',
  'multicam_build',
  'navigate',
  'playhead',
]);

const IDEMPOTENT_TOOL_NAMES = new Set([
  'project_save',
  'track_update',
  'clip_update',
  'clip_effects',
  'caption_update',
  'audio_mix',
  'caption_style_update',
  'settings_set_tools',
  'settings_set',
  'navigate',
  'playhead',
]);

const OPEN_WORLD_TOOL_NAMES = new Set([
  'project_open',
  'project_save',
  'project_save_as',
  'diarize',
  'export_render',
  'export_interchange',
  'factory_run',
  'extract_audio',
  'write_chapters',
  'remux',
  'export_lossless',
  'asset_import',
  'package_project',
  'run_command',
]);

function toolTitle(name: string): string {
  return name
    .split('_')
    .map((part) => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
    .join(' ');
}

/** Catálogo MCP normalizado: cada herramienta declara su perfil de riesgo. */
export const MCP_TOOLS: readonly McpToolDefinition[] = RAW_MCP_TOOLS.map((tool) => {
  const readOnly = READ_ONLY_TOOL_NAMES.has(tool.name);
  return {
    ...tool,
    annotations: {
      title: toolTitle(tool.name),
      readOnlyHint: readOnly,
      destructiveHint: !readOnly && !ADDITIVE_TOOL_NAMES.has(tool.name),
      idempotentHint: !readOnly && IDEMPOTENT_TOOL_NAMES.has(tool.name),
      openWorldHint: OPEN_WORLD_TOOL_NAMES.has(tool.name),
      ...tool.annotations,
    },
  };
});

export const MCP_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(
  MCP_TOOLS
    .filter((tool) => tool.annotations?.readOnlyHint === true)
    .map((tool) => tool.name),
);

export const MCP_TOOL_BY_NAME: ReadonlyMap<string, McpToolDefinition> = new Map(
  MCP_TOOLS.map((tool) => [tool.name, tool]),
);
