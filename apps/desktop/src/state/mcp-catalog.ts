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
}

const obj = (
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required: [...required] } : {}),
});

const str = (description?: string) =>
  description ? { type: 'string', description } : { type: 'string' };
const num = (description?: string) =>
  description ? { type: 'number', description } : { type: 'number' };
const bool = (description?: string) =>
  description ? { type: 'boolean', description } : { type: 'boolean' };

const READ = 'Sólo lectura.';
const WRITE = 'Modifica el proyecto (se puede deshacer con undo).';

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  // ── Estado y lectura ────────────────────────────────────────────────
  {
    name: 'app_status',
    description: `${READ} Si hay proyecto abierto y cuál.`,
    inputSchema: obj({}),
  },
  {
    name: 'project_summary',
    description: `${READ} Formato, fps, duración, pistas, clips, subtítulos y assets.`,
    inputSchema: obj({}),
  },
  {
    name: 'timeline_clips',
    description: `${READ} Clips con id, pista, tipo, inicio, duración, motion y ganancia.`,
    inputSchema: obj({}),
  },
  {
    name: 'captions_list',
    description: `${READ} Subtítulos con id, tiempos, texto y hablante.`,
    inputSchema: obj({}),
  },
  {
    name: 'assets_list',
    description: `${READ} Medios del proyecto con id, tipo, ruta y metadatos.`,
    inputSchema: obj({}),
  },
  {
    name: 'tracks_list',
    description: `${READ} Pistas con id, tipo, nombre, bloqueo, silencio y cantidad de clips.`,
    inputSchema: obj({}),
  },
  {
    name: 'export_profiles',
    description: `${READ} Perfiles de exportación con formato, resolución y bitrate.`,
    inputSchema: obj({}),
  },

  // ── Proyecto ────────────────────────────────────────────────────────
  {
    name: 'project_new',
    description: `${WRITE} Crea un proyecto nuevo (descarta el abierto si no está guardado).`,
    inputSchema: obj(
      {
        name: str(),
        width: num('por defecto 1920'),
        height: num('por defecto 1080'),
        fps: num('por defecto 30'),
      },
      ['name'],
    ),
  },
  {
    name: 'project_open',
    description: 'Abre un proyecto desde una ruta absoluta.',
    inputSchema: obj({ path: str() }, ['path']),
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
    inputSchema: obj({ kind: str(), label: str() }, ['kind']),
  },
  {
    name: 'track_update',
    description: `${WRITE} Cambia nombre, bloqueo, silencio u ocultamiento de una pista.`,
    inputSchema: obj(
      { trackId: str(), label: str(), locked: bool(), muted: bool(), hidden: bool() },
      ['trackId'],
    ),
  },
  {
    name: 'track_delete',
    description: `${WRITE} Borra una pista vacía.`,
    inputSchema: obj({ trackId: str() }, ['trackId']),
  },

  // ── Clips ───────────────────────────────────────────────────────────
  {
    name: 'clip_add',
    description: `${WRITE} Agrega un medio a la timeline.`,
    inputSchema: obj(
      { assetId: str(), atFrame: num(), durationFrames: num(), trackId: str() },
      ['assetId'],
    ),
  },
  {
    name: 'clip_update',
    description: `${WRITE} Etiqueta, habilitado, ganancia o movimiento de un clip.`,
    inputSchema: obj(
      {
        clipId: str(),
        label: str(),
        enabled: bool(),
        gainDb: num(),
        motion: {
          type: ['string', 'null'],
          enum: ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', null],
        },
        motionIntensity: num(),
      },
      ['clipId'],
    ),
  },
  {
    name: 'clip_move',
    description: `${WRITE} Mueve un clip a un frame y, opcionalmente, a otra pista.`,
    inputSchema: obj({ clipId: str(), startFrame: num(), trackId: str() }, [
      'clipId',
      'startFrame',
    ]),
  },
  {
    name: 'clip_split',
    description: `${WRITE} Divide un clip en un frame.`,
    inputSchema: obj({ clipId: str(), atFrame: num() }, ['clipId', 'atFrame']),
  },
  {
    name: 'clip_delete',
    description: `${WRITE} Elimina un clip.`,
    inputSchema: obj({ clipId: str() }, ['clipId']),
  },
  {
    name: 'clip_effects',
    description: `${WRITE} Velocidad o reproducción inversa de un clip.`,
    inputSchema: obj({ clipId: str(), speed: num('1 = normal'), reverse: bool() }, ['clipId']),
  },

  // ── Subtítulos ──────────────────────────────────────────────────────
  {
    name: 'caption_add',
    description: `${WRITE} Agrega un subtítulo.`,
    inputSchema: obj(
      { text: str(), startFrame: num(), durationFrames: num() },
      ['text', 'startFrame', 'durationFrames'],
    ),
  },
  {
    name: 'caption_update',
    description: `${WRITE} Cambia texto o tiempos de un subtítulo.`,
    inputSchema: obj({ cueId: str(), text: str(), startFrame: num(), endFrame: num() }, [
      'cueId',
    ]),
  },
  {
    name: 'caption_delete',
    description: `${WRITE} Elimina un subtítulo.`,
    inputSchema: obj({ cueId: str() }, ['cueId']),
  },
  {
    name: 'diarize',
    description: `${WRITE} Etiqueta hablantes en los subtítulos con el proveedor configurado.`,
    inputSchema: obj({ clipId: str(), prefix: bool(), language: str() }, ['clipId']),
  },

  // ── Audio ───────────────────────────────────────────────────────────
  {
    name: 'audio_mix',
    description: `${WRITE} Ganancia master, limitador y objetivo de loudness.`,
    inputSchema: obj({ masterGainDb: num(), masterLimiter: bool(), targetLufs: num() }),
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
        outputDir: str(),
        profileId: str(),
      },
      ['kind'],
    ),
  },
  {
    name: 'critic_run',
    description: `${READ} Evalúa la edición: puntaje y hallazgos con severidad.`,
    inputSchema: obj({}),
  },
  {
    name: 'critic_fix',
    description: `${WRITE} Aplica los arreglos automáticos del crítico.`,
    inputSchema: obj({ rules: { type: 'array', items: { type: 'string' } } }),
  },
  {
    name: 'export_render',
    description: 'Renderiza y verifica el MP4 de entrega.',
    inputSchema: obj({ outputDir: str(), profileId: str(), qualityCheck: bool() }),
  },
  {
    name: 'export_interchange',
    description: 'Exporta EDL, OTIO o FCPXML para otro editor.',
    inputSchema: obj(
      { format: { type: 'string', enum: ['edl', 'otio', 'fcpxml'] }, directory: str() },
      ['format', 'directory'],
    ),
  },

  // ── Multicámara y fábrica ───────────────────────────────────────────
  {
    name: 'multicam_build',
    description: `${WRITE} Arma el corte multicámara en una pista nueva (por voz o con cortes dados).`,
    inputSchema: obj(
      {
        assetIds: { type: 'array', items: { type: 'string' } },
        offsets: { type: 'object', description: 'offsetFrames por assetId' },
        autoCut: bool('por defecto true'),
      },
      ['assetIds'],
    ),
  },
  {
    name: 'factory_run',
    description:
      'Genera un video completo desde un brief (guion, voz, escenas y render). Puede tardar varios minutos.',
    inputSchema: obj(
      {
        brief: str(),
        outputDir: str(),
        scenes: num('1–12'),
        width: num(),
        height: num(),
        language: str(),
        render: bool(),
      },
      ['brief'],
    ),
  },

  // ── Estilos y herramientas ──────────────────────────────────────────
  {
    name: 'caption_style_update',
    description: `${WRITE} Cambia tipografía, tamaño y colores de un estilo de subtítulo.`,
    inputSchema: obj(
      {
        styleId: str(),
        name: str(),
        fontFamily: str(),
        fontSizePx: num(),
        color: str(),
        outlineColor: str(),
        backgroundColor: str(),
      },
      ['styleId'],
    ),
  },
  {
    name: 'settings_set_tools',
    description: 'Fija las rutas de FFmpeg y FFprobe (valida que existan).',
    inputSchema: obj({ ffmpeg: str(), ffprobe: str() }),
  },

  // ── Medios ──────────────────────────────────────────────────────────
  {
    name: 'asset_import',
    description: `${WRITE} Importa archivos del disco al proyecto (rutas absolutas).`,
    inputSchema: obj({ paths: { type: 'array', items: { type: 'string' } } }, ['paths']),
  },
  {
    name: 'asset_remove',
    description: `${WRITE} Quita un medio del proyecto (no borra el archivo).`,
    inputSchema: obj({ assetId: str() }, ['assetId']),
  },

  // ── Marcadores ──────────────────────────────────────────────────────
  {
    name: 'markers_list',
    description: `${READ} Marcadores con id, frame, etiqueta y color.`,
    inputSchema: obj({}),
  },
  {
    name: 'marker_add',
    description: `${WRITE} Agrega un marcador en un frame.`,
    inputSchema: obj({ frame: num(), label: str(), endFrame: num() }, ['frame']),
  },
  {
    name: 'marker_delete',
    description: `${WRITE} Borra un marcador.`,
    inputSchema: obj({ markerId: str() }, ['markerId']),
  },

  // ── Ajustes y paquete ───────────────────────────────────────────────
  {
    name: 'settings_get',
    description: `${READ} Proveedor de IA y de diarización configurados (sin claves).`,
    inputSchema: obj({}),
  },
  {
    name: 'settings_set',
    description: 'Configura el proveedor de IA y/o el de diarización. La clave va al almacén de Windows.',
    inputSchema: obj({
      ai: obj({ kind: str(), baseUrl: str(), model: str(), apiKey: str() }),
      diarize: obj({ kind: str(), baseUrl: str(), language: str(), apiKey: str() }),
    }),
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
  },
  {
    name: 'review_apply',
    description: `${WRITE} Aplica sólo los ítems aceptados de la revisión.`,
    inputSchema: obj({ accepted: { type: 'array', items: { type: 'string' } } }),
  },

  // ── Interfaz ────────────────────────────────────────────────────────
  {
    name: 'navigate',
    description: 'Abre una vista de la app.',
    inputSchema: obj({ view: str() }, ['view']),
  },
  {
    name: 'playhead',
    description: 'Mueve el cabezal de reproducción.',
    inputSchema: obj({ frame: num() }, ['frame']),
  },
  {
    name: 'run_command',
    description: 'Ejecuta un comando del editor en lenguaje natural.',
    inputSchema: obj({ command: str() }, ['command']),
  },
];
