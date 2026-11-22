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
      limit: boundedNum(1, 500),
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
    name: 'media_analyze',
    description: `${READ} Analiza el contenido visual de assets del proyecto (imagen completa o cuadro medio de video: escena, color, nitidez, rostros) con el motor local.`,
    inputSchema: obj(
      {
        assetIds: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
      ['assetIds'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'media_convert',
    description: `${WRITE} Convierte assets del proyecto a otro formato (png/jpg/webp/mp4/mkv/webm/mov/mp3/wav/m4a…) en outputDir. assetIds 1-20; con uno solo usa la vía simple.`,
    inputSchema: obj(
      {
        assetIds: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 256 },
        },
        target: { type: 'string', minLength: 2, maxLength: 16 },
        outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
        quality: boundedInt(1, 100),
        maxWidth: boundedInt(16, 7680),
      },
      ['assetIds', 'target', 'outputDir'],
    ),
  },
  {
    name: 'fs_check',
    description: `${READ} Verifica qué rutas absolutas del disco existen y devuelve metadatos básicos (tipo, tamaño).`,
    inputSchema: obj(
      {
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 32_768 },
        },
      },
      ['paths'],
    ),
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
    description: `${WRITE} Crea un proyecto nuevo. Con «directory» lo escribe directo en esa carpeta y lo abre sin diálogo (uso por MCP); sin «directory» abre el diálogo nativo de guardado.`,
    inputSchema: obj(
      {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        width: boundedInt(2, 7680),
        height: boundedInt(2, 4320),
        fps: boundedNum(1, 240),
        directory: { type: 'string', maxLength: 32_768 },
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
    name: 'clip_slip',
    description: `${WRITE} Slip: mueve la ventana de origen del clip sin cambiar su posición ni duración en la timeline (delta en frames de origen; positivo = más adelante en el material).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      deltaFrames: boundedInt(-1_000_000, 1_000_000),
    }, ['clipId', 'deltaFrames']),
  },
  {
    name: 'clip_slide',
    description: `${WRITE} Slide: mueve el clip entre sus vecinos contiguos absorbiendo el delta en los bordes de edición (estilo Premiere); el clip conserva duración y ventana de origen.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      deltaFrames: boundedInt(-1_000_000, 1_000_000),
    }, ['clipId', 'deltaFrames']),
  },
  {
    name: 'clip_roll',
    description: `${WRITE} Roll: mueve el punto de corte entre dos clips contiguos sin mover los bordes externos; edge 'in' corta con el clip anterior, 'out' con el siguiente.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      edge: { type: 'string', enum: ['in', 'out'] },
      deltaFrames: boundedInt(-1_000_000, 1_000_000),
    }, ['clipId', 'edge', 'deltaFrames']),
  },
  {
    name: 'clip_speed_ramp',
    description: `${WRITE} Rampa de velocidad sobre un clip (o varios si la selección lo indica): velocidad inicial → final con easing; devuelve los clips resultantes.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      from: boundedNum(0.1, 4),
      to: boundedNum(0.1, 4),
    }, ['clipId', 'from', 'to']),
  },
  {
    name: 'clip_speed_curve',
    description: `${WRITE} Curva de velocidad continua (speed ramp) sobre un clip de video: points [{t:0..1, speed:0.1..4, easing?, bezier?}] mínimo 2 puntos, primero t=0 y último t=1; opcional opticalFlow y targetFps (24/30/60/120).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      points: {
        type: 'array',
        minItems: 2,
        maxItems: 50,
        items: { type: 'object' },
      },
      opticalFlow: bool(),
      targetFps: { type: 'integer', enum: [24, 30, 60, 120] },
    }, ['clipId', 'points']),
  },
  {
    name: 'clip_stabilize',
    description: `${WRITE} Aplica estabilización a un clip de video (necesita transformFile del análisis de stabilization_analyze); sin transformFile la quita.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      transformFile: { type: 'string', maxLength: 1024 },
      smoothing: boundedNum(1, 60),
      inFrame: boundedInt(0, 100_000_000),
      outFrame: boundedInt(0, 100_000_000),
      previewProxy: { type: 'string', maxLength: 1024 },
    }, ['clipId']),
    // Si no llega transformFile se interpreta como quitar la estabilización.
  },
  {
    name: 'clip_freeze',
    description: `${WRITE} Congela un frame del clip de video como clip de imagen en el punto indicado (atFrame dentro del clip); assetId debe ser un asset imagen ya importado del frame.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      atFrame: boundedInt(0, 100_000_000),
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      durationFrames: boundedInt(1, 10_000_000),
    }, ['clipId', 'atFrame', 'assetId']),
  },
  {
    name: 'clip_detach_audio',
    description: `${WRITE} Desvincula el audio de un clip de video a su propia pista de audio.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'clip_duplicate',
    description: `${WRITE} Duplica un clip (offset según la implementación del editor).`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'clip_compound',
    description: `${WRITE} Agrupa los clips que se solapan con el clip indicado en un clip compuesto.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'compound_expand',
    description: `${WRITE} Deshace un clip compuesto y restaura sus clips internos en la timeline.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'adjustment_add',
    description: `${WRITE} Agrega una capa de ajuste (adjustment layer) en un frame; los efectos aplicados a ella afectan a todo lo que está debajo.`,
    inputSchema: obj({
      atFrame: boundedInt(0, 100_000_000),
      durationFrames: boundedInt(1, 10_000_000),
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['atFrame']),
  },
  {
    name: 'clip_replace',
    description: `${WRITE} Reemplaza el medio de un clip por otro asset del proyecto (p. ej. versión procesada/denoised); conserva posición, duración y efectos.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      sourceOffset: boundedInt(0, 100_000_000),
    }, ['clipId', 'assetId']),
  },
  {
    name: 'clip_split_multi',
    description: `${WRITE} Divide un clip en varios frames de corte a la vez (frames absolutos de timeline dentro del clip).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frames: { type: 'array', minItems: 1, maxItems: 200, items: boundedInt(0, 100_000_000) },
    }, ['clipId', 'frames']),
  },
  {
    name: 'track_split',
    description: `${WRITE} Corta todos los clips de una pista en los frames indicados (razor multi-clip).`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      frames: { type: 'array', minItems: 1, maxItems: 200, items: boundedInt(0, 100_000_000) },
    }, ['trackId', 'frames']),
  },
  {
    name: 'split_at_markers',
    description: `${WRITE} Divide los clips en todos los marcadores del proyecto (o de las pistas indicadas).`,
    inputSchema: obj({
      trackIds: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 256 } },
    }),
  },
  {
    name: 'cut_at_frame',
    description: `${WRITE} Corta en un frame y conserva solo un lado: 'left' mantiene lo anterior al frame, 'right' lo posterior (sobre el clip indicado o toda la timeline).`,
    inputSchema: obj({
      atFrame: boundedInt(0, 100_000_000),
      side: { type: 'string', enum: ['left', 'right'] },
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['atFrame', 'side']),
  },
  {
    name: 'captions_from_scenes',
    description: `${WRITE} Genera cues de subtítulos a partir de las escenas con narración del proyecto.`,
    inputSchema: obj({}),
  },
  {
    name: 'audio_preset_apply_all',
    description: `${WRITE} Aplica un preset de audio ('voice' | 'music') a todos los clips de audio del proyecto.`,
    inputSchema: obj({ preset: { type: 'string', enum: ['voice', 'music'] } }, ['preset']),
  },
  {
    name: 'transition_apply_cuts',
    description: `${WRITE} Aplica una transición de corte a todos los cortes contiguos (tipo opcional: dissolve, fade-black, slide-*, wipe-*, etc.; frames, color para dip-color).`,
    inputSchema: obj({
      type: { type: 'string', maxLength: 64 },
      frames: boundedInt(1, 600),
      color: { type: 'string', maxLength: 16 },
      trackIds: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 256 } },
    }),
  },
  {
    name: 'timeline_trim_start',
    description: `${WRITE} Recorta el inicio de la timeline (mueve todo hacia el frame 0).`,
    inputSchema: obj({ frames: boundedInt(0, 100_000_000) }, ['frames']),
  },
  {
    name: 'clip_mask_set',
    description: `${WRITE} Define o quita la máscara de un clip (formas rectangle/ellipse/polygon/freehand/text, feather, invert, stroke, keyframes). mask:null la elimina.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      mask: {
        type: ['object', 'null'],
        description: 'ClipMask: {shape: rectangle|ellipse|diamond|triangle|rounded|polygon|freehand|star|heart|text, x,y (-1..1), width,height (0..2), rotationDeg?, feather 0..1, expand?, invert?, strokeColor #rrggbb?, strokeWidth?, text?, fontScale?, points? (polygon/freehand), keyframes?}. null quita la máscara.',
      },
    }, ['clipId', 'mask']),
  },
  {
    name: 'mask_keyframe_add',
    description: `${WRITE} Agrega o reemplaza un keyframe de máscara en un frame local del clip (x,y,width,height,rotationDeg,feather,easing).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: boundedInt(0, 10_000_000),
      x: boundedNum(-1, 1),
      y: boundedNum(-1, 1),
      width: boundedNum(0.01, 2),
      height: boundedNum(0.01, 2),
      rotationDeg: boundedNum(-180, 180),
      feather: boundedNum(0, 1),
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
    }, ['clipId', 'frame']),
  },
  {
    name: 'mask_keyframe_remove',
    description: `${WRITE} Quita un keyframe de máscara en un frame local del clip.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: boundedInt(0, 10_000_000),
    }, ['clipId', 'frame']),
  },
  {
    name: 'clip_mask_from_face',
    description: `${WRITE} Convierte un track facial (de analyze_face_track) en máscara poligonal animada sobre un clip: polígono alrededor del rostro + keyframes x/y que lo siguen. Mismas muestras {time,centerX,centerY,size?} del análisis.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      samples: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: { type: 'object' },
        description: 'Muestras {time, centerX, centerY, size?} — salen de analyze_face_track.',
      },
      feather: boundedNum(0, 1),
      invert: bool(),
    }, ['clipId', 'samples']),
  },
  {
    name: 'mask_keyframes_clear',
    description: `${WRITE} Elimina todos los keyframes de la máscara de un clip.`,
    inputSchema: obj({ clipId: { type: 'string', minLength: 1, maxLength: 256 } }, ['clipId']),
  },
  {
    name: 'project_look_set',
    description: `${WRITE} Define el look global del proyecto (ClipEffects: lutFile, exposure, contrast, saturation, temperature, tint, highlights, shadows, vibrance...) o null para quitarlo.`,
    inputSchema: obj({
      look: { type: ['object', 'null'] },
    }, ['look']),
  },
  {
    name: 'marker_update',
    description: `${WRITE} Edita un marcador: frame, endFrame (rango), label, color, note, role 'cover'.`,
    inputSchema: obj({
      markerId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: boundedInt(0, 100_000_000),
      endFrame: boundedInt(0, 100_000_000),
      label: { type: 'string', maxLength: 200 },
      color: { type: 'string', enum: ['mint', 'amber', 'rose', 'blue', 'violet', 'slate'] },
      note: { type: 'string', maxLength: 500 },
      role: { type: 'string', enum: ['cover'] },
    }, ['markerId']),
  },
  {
    name: 'markers_clear',
    description: `${WRITE} Elimina todos los marcadores del proyecto.`,
    inputSchema: obj({}),
  },
  {
    name: 'markers_from_scenes',
    description: `${WRITE} Crea marcadores a partir de las escenas del proyecto.`,
    inputSchema: obj({}),
  },
  {
    name: 'markers_from_cuts',
    description: `${WRITE} Crea un marcador por cada frame de corte indicado (deduplica los existentes).`,
    inputSchema: obj({
      frames: { type: 'array', minItems: 1, maxItems: 200, items: boundedInt(0, 100_000_000) },
    }, ['frames']),
  },
  {
    name: 'caption_title_add',
    description: `${WRITE} Agrega un título (cue de texto grande centrado con estilo propio) en un frame.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 500 },
      startFrame: boundedInt(0, 100_000_000),
      durationFrames: boundedInt(1, 10_000_000),
      styleId: { type: 'string', maxLength: 256 },
    }, ['text']),
  },
  {
    name: 'scene_add',
    description: `${WRITE} Agrega una escena al proyecto (unidad narrativa: título, intención, narración, notas).`,
    inputSchema: obj({
      title: { type: 'string', minLength: 1, maxLength: 200 },
      intent: { type: 'string', enum: ['hook', 'context', 'explainer', 'demo', 'proof', 'cta', 'outro'] },
      narration: { type: 'string', minLength: 1, maxLength: 4000 },
      notes: { type: 'string', maxLength: 2000 },
    }, ['title', 'intent', 'narration']),
  },
  {
    name: 'scene_update',
    description: `${WRITE} Edita una escena: título, intención, estado (draft|reviewed|approved), notas o narración.`,
    inputSchema: obj({
      sceneId: { type: 'string', minLength: 1, maxLength: 256 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      intent: { type: 'string', enum: ['hook', 'context', 'explainer', 'demo', 'proof', 'cta', 'outro'] },
      status: { type: 'string', enum: ['draft', 'reviewed', 'approved'] },
      notes: { type: 'string', maxLength: 2000 },
      narration: { type: 'string', minLength: 1, maxLength: 4000 },
    }, ['sceneId']),
  },
  {
    name: 'scene_remove',
    description: `${WRITE} Elimina una escena (falla si una fuente la cita).`,
    inputSchema: obj({ sceneId: { type: 'string', minLength: 1, maxLength: 256 } }, ['sceneId']),
  },
  {
    name: 'scene_reorder',
    description: `${WRITE} Reordena las escenas con la lista completa de ids en el orden deseado.`,
    inputSchema: obj({
      sceneIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 256 } },
    }, ['sceneIds']),
  },
  {
    name: 'overlay_face_center',
    description: `${WRITE} Aplica seguimiento de rostro (face crop/center) a un clip de video a partir de muestras de posición.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      samples: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: { type: 'object' },
        description: 'Muestras {time, centerX, centerY, size?, rotationDeg?} —通常 salen de analyze_face_track/track_object mapeadas a esa forma.',
      },
      smoothing: boundedNum(0, 1),
    }, ['clipId', 'samples']),
  },
  {
    name: 'overlay_face_blur',
    description: `${WRITE} Crea un overlay de privacidad sobre el rostro (blur o pixelate) animado por muestras de tracking.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      samples: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: { type: 'object' },
        description: 'Muestras {time, centerX, centerY, size?, rotationDeg?} —通常 salen de analyze_face_track/track_object mapeadas a esa forma.',
      },
      blur: boundedNum(0, 50),
      margin: boundedNum(1, 3),
      feather: boundedNum(0, 1),
      smoothing: boundedNum(0, 1),
      kind: { type: 'string', enum: ['blur', 'pixelate'] },
      pixelSize: boundedInt(2, 96),
    }, ['clipId', 'samples']),
  },
  {
    name: 'overlay_mask_track',
    description: `${WRITE} Aplica una máscara animada que sigue un objeto/rostro trackeado (muestras {time,centerX,centerY,size}).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      samples: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: { type: 'object' },
        description: 'Muestras {time, centerX, centerY, size?, rotationDeg?} —通常 salen de analyze_face_track/track_object mapeadas a esa forma.',
      },
      margin: boundedNum(1, 3),
      feather: boundedNum(0, 1),
      invert: bool(),
      smoothing: boundedNum(0, 1),
    }, ['clipId', 'samples']),
  },
  {
    name: 'overlay_breathing',
    description: `${WRITE} Aplica «respiración» idle (loop suave de escala) a un clip de video/imagen/gráfico.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      amplitude: boundedNum(0.01, 0.3),
      periodSeconds: boundedNum(0.4, 30),
    }, ['clipId']),
  },
  {
    name: 'overlay_click_pulse',
    description: `${WRITE} Aplica el gesto de «clic» (pulsación de escala) a un clip en un offset dentro de él.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      atOffset: boundedInt(0, 10_000_000),
    }, ['clipId']),
  },
  {
    name: 'delivery_compression',
    description: `${WRITE} Aplica un preset de compresión a los perfiles de render del proyecto (rapido|equilibrado|compacto|maximo) con codec opcional.`,
    inputSchema: obj({
      preset: { type: 'string', enum: ['rapido', 'equilibrado', 'compacto', 'maximo'] },
      videoCodec: { type: 'string', enum: ['h264', 'h265', 'vp9', 'av1', 'prores'] },
    }, ['preset']),
  },
  {
    name: 'delivery_profile_fit',
    description: `${WRITE} Define el ajuste de todos los perfiles de render (contain|cover|blur).`,
    inputSchema: obj({
      fit: { type: 'string', enum: ['contain', 'cover', 'blur'] },
    }, ['fit']),
  },
  {
    name: 'delivery_pixel_format',
    description: `${WRITE} Define el formato de píxel de todos los perfiles de render (yuv420p|yuv444p|yuv422p10le|yuva444p10le).`,
    inputSchema: obj({
      pixelFormat: { type: 'string', enum: ['yuv420p', 'yuv444p', 'yuv422p10le', 'yuva444p10le'] },
    }, ['pixelFormat']),
  },
  {
    name: 'keyframe_remove',
    description: `${WRITE} Elimina la keyframe de transform de un clip en el frame absoluto dado.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'keyframe_clear',
    description: `${WRITE} Borra todas las keyframes de transform del clip; freezeAtFrame (opcional) deja el clip congelado en ese frame local.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      freezeAtFrame: boundedInt(0, 100000000),
    }, ['clipId']),
  },
  {
    name: 'keyframe_paste_at_frame',
    description: `${WRITE} Aplica un patch de transform (offsetX/Y, scale, rotationDeg, opacity, easing, bezier) a TODOS los clips que cubren el frame absoluto de timeline.`,
    inputSchema: obj(Object.assign({}, {
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
      offsetX: boundedInt(-100000, 100000),
      offsetY: boundedInt(-100000, 100000),
      scale: boundedNum(0.5, 4),
      rotationDeg: boundedNum(-360, 360),
      opacity: boundedNum(0, 1),
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
      bezier: {
        type: 'object',
        properties: {
          cp1X: boundedNum(0, 1), cp1Y: boundedNum(-1, 2),
          cp2X: boundedNum(0, 1), cp2Y: boundedNum(-1, 2),
        },
        required: ['cp1X', 'cp1Y', 'cp2X', 'cp2Y'],
      },
    }, {
      frame: { type: 'integer', minimum: 0, maximum: 100000000, description: 'frame absoluto de timeline' },
    }), ['frame']),
  },
  {
    name: 'keyframe_bezier_apply',
    description: `${WRITE} Aplica una curva Bézier de easing (cp1X,cp1Y,cp2X,cp2Y) a todas las keyframes de transform del clip.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      cp1X: boundedNum(0, 1), cp1Y: boundedNum(-1, 2),
      cp2X: boundedNum(0, 1), cp2Y: boundedNum(-1, 2),
    }, ['clipId', 'cp1X', 'cp1Y', 'cp2X', 'cp2Y']),
  },
  {
    name: 'keyframe_snapshot',
    description: `${READ} Devuelve el patch de transform guardado en la keyframe exacta del clip (frame absoluto→local), o null.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'keyframe_capture',
    description: `${READ} Muestrea el transform actual del clip en el frame (frames absolutos→local) listo para fijarlo como keyframe.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'keyframe_transform_at',
    description: `${READ} Interpola y devuelve el transform efectivo del clip en el frame (keyframes + estáticos).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'gain_keyframe_add',
    description: `${WRITE} Agrega/actualiza una keyframe de ganancia de audio (dB) del clip en el frame absoluto.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
      gainDb: boundedNum(-60, 12),
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
    }, ['clipId', 'frame', 'gainDb']),
  },
  {
    name: 'gain_keyframe_remove',
    description: `${WRITE} Elimina la keyframe de ganancia del clip en el frame absoluto.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'gain_keyframes_clear',
    description: `${WRITE} Borra todas las keyframes de ganancia del clip; freezeAtFrame (opcional) fija la ganancia en ese frame local.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      freezeAtFrame: boundedInt(0, 100000000),
    }, ['clipId']),
  },
  {
    name: 'clip_gain_at',
    description: `${READ} Devuelve la ganancia de audio efectiva (dB) del clip en el frame (keyframes interpoladas + estática).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId', 'frame']),
  },
  {
    name: 'clip_slowmo_smoothing',
    description: `${WRITE} Activa/desactiva la interpolación óptica (slow-motion smoothing) de un clip de video.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      enabled: bool(),
    }, ['clipId', 'enabled']),
  },
  {
    name: 'track_gain_keyframe_add',
    description: `${WRITE} Agrega/actualiza una keyframe de ganancia de pista (dB, -60..12) en el frame absoluto de timeline.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
      gainDb: boundedNum(-60, 12),
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
    }, ['trackId', 'frame', 'gainDb']),
  },
  {
    name: 'track_gain_keyframe_remove',
    description: `${WRITE} Elimina la keyframe de ganancia de pista en el frame.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['trackId', 'frame']),
  },
  {
    name: 'track_gain_keyframes_clear',
    description: `${WRITE} Borra todas las keyframes de ganancia de la pista; freezeAtFrame opcional fija el nivel.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      freezeAtFrame: boundedInt(0, 100000000),
    }, ['trackId']),
  },
  {
    name: 'track_pan_keyframe_add',
    description: `${WRITE} Agrega/actualiza una keyframe de panorama de pista (-1..1) en el frame absoluto.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
      value: boundedNum(-1, 1),
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] },
    }, ['trackId', 'frame', 'value']),
  },
  {
    name: 'track_pan_keyframe_remove',
    description: `${WRITE} Elimina la keyframe de panorama de pista en el frame.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      frame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['trackId', 'frame']),
  },
  {
    name: 'track_pan_keyframes_clear',
    description: `${WRITE} Borra todas las keyframes de panorama de la pista; freezeAtFrame opcional fija el valor.`,
    inputSchema: obj({
      trackId: { type: 'string', minLength: 1, maxLength: 256 },
      freezeAtFrame: boundedInt(0, 100000000),
    }, ['trackId']),
  },
  {
    name: 'caption_text_split',
    description: `${READ} Parte un texto largo en cues de subtítulo respetando oraciones (splitCaptionText).`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 100000 },
      maxChars: boundedInt(10, 500),
    }, ['text']),
  },
  {
    name: 'caption_wrap',
    description: `${READ} Envuelve texto de subtítulo en líneas equilibradas (UAX#14) para un ancho dado.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 20000 },
      maxCharsPerLine: boundedInt(12, 120),
      maxLines: boundedInt(1, 4),
    }, ['text']),
  },
  {
    name: 'caption_plan_cues',
    description: `${READ} Planifica cues de subtítulo (tiempos, líneas, CPS) desde segmentos transcritos. No toca el proyecto.`,
    inputSchema: obj({
      segments: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: {
          type: 'object',
          properties: {
            start: { type: 'number', minimum: 0 },
            end: { type: 'number', minimum: 0 },
            text: { type: 'string', maxLength: 20000 },
            words: { type: 'array', maxItems: 20000, items: { type: 'object' } },
          },
          required: ['start', 'end', 'text'],
        },
      },
      maxCharsPerLine: boundedInt(12, 120),
      maxLines: boundedInt(1, 4),
      maxDurationSeconds: boundedNum(0.5, 30),
      minDurationSeconds: boundedNum(0, 10),
      maxCps: boundedNum(1, 60),
    }, ['segments']),
  },
  {
    name: 'narration_plan_build',
    description: `${READ} Agrupa segmentos transcritos en frases de narración con pausas (plan puro, no aplica).`,
    inputSchema: obj({
      segments: {
        type: 'array',
        minItems: 1,
        maxItems: 5000,
        items: {
          type: 'object',
          properties: {
            start: { type: 'number', minimum: 0 },
            end: { type: 'number', minimum: 0 },
            text: { type: 'string', maxLength: 20000 },
            words: { type: 'array', maxItems: 20000, items: { type: 'object' } },
          },
          required: ['start', 'end', 'text'],
        },
      },
      pauseSeconds: boundedNum(0, 5),
      maxSentenceSeconds: boundedNum(0.5, 30),
      minSentenceSeconds: boundedNum(0, 10),
      leadSeconds: boundedNum(0, 5),
      tailSeconds: boundedNum(0, 5),
    }, ['segments']),
  },
  {
    name: 'smart_bin_list',
    description: `${READ} Lista los smart bins integrados y los custom guardados (reglas de filtro de assets).`,
    inputSchema: obj({}),
  },
  {
    name: 'assets_smart_bin_filter',
    description: `${READ} Filtra los assets del proyecto por una regla smart bin (kind/status/tag/bin/query/favoritesOnly).`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['all', 'video', 'image', 'audio', 'text', 'font'] },
      status: { type: 'string', enum: ['any', 'ready', 'unverified', 'missing', 'failed'] },
      favoritesOnly: bool(),
      tag: { type: 'string', maxLength: 200 },
      bin: { type: 'string', maxLength: 200 },
      query: { type: 'string', maxLength: 500 },
    }, []),
  },
  {
    name: 'smart_bin_create',
    description: `${WRITE} Crea un smart bin custom persistente (regla de filtro de assets, máx 20).`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 40 },
      kind: { type: 'string', enum: ['all', 'video', 'image', 'audio', 'text', 'font'] },
      status: { type: 'string', enum: ['any', 'ready', 'unverified', 'missing', 'failed'] },
      favoritesOnly: bool(),
      tag: { type: 'string', maxLength: 200 },
      bin: { type: 'string', maxLength: 200 },
      query: { type: 'string', maxLength: 500 },
    }, ['name']),
  },
  {
    name: 'smart_bin_remove',
    description: `${WRITE} Elimina un smart bin custom por id.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['id']),
  },
  {
    name: 'luma_mate_candidates',
    description: `${READ} Lista los clips candidatos a actuar como luma matte del clip dado (video/image contiguos previos).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['clipId']),
  },
  {
    name: 'luma_mate_move_track',
    description: `${WRITE} Mueve un clip mate (luma) a su propia pista etiquetada. Devuelve null si no existe.`,
    inputSchema: obj({
      mateClipId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['mateClipId']),
  },
  {
    name: 'luma_mate_place_freeze',
    description: `${WRITE} Crea un mate freeze (frame estático como asset imagen) en una pista nueva y devuelve ids.`,
    inputSchema: obj({
      frameAssetId: { type: 'string', minLength: 1, maxLength: 256 },
      startFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
      durationFrames: { type: 'integer', minimum: 1, maximum: 100000000 },
      label: { type: 'string', maxLength: 200 },
    }, ['frameAssetId', 'startFrame', 'durationFrames']),
  },
  {
    name: 'adaptive_profile',
    description: `${READ} Mide el perfil adaptativo del proyecto (umbral de silencio, denoise, zoom, LUFS) a partir de los picos de audio.`,
    inputSchema: obj({}),
  },
  {
    name: 'auto_edit_build',
    description: `${WRITE} Montaje automático por escenas del guion: asigna imágenes/video por escena (order|match), captions y transiciones. Requiere escenas en el proyecto.`,
    inputSchema: obj({
      assignment: { type: 'string', enum: ['order', 'match'] },
      includeCaptions: bool(),
      replaceTimeline: bool(),
      maxCaptionChars: boundedInt(10, 500),
      photoMotion: { type: 'string', enum: ['auto', 'none'] },
      transitionFrames: boundedInt(0, 240),
      includeVideos: bool(),
      mediaByScene: { type: 'object' },
    }, ['assignment', 'includeCaptions', 'replaceTimeline']),
  },
  {
    name: 'auto_edit_prepare',
    description: `${WRITE} Igual que auto_edit_build pero con narraciones por escena (assetId de audio ya generado). Exige confirmVoiceRights=true.`,
    inputSchema: obj({
      narrations: {
        type: 'array', minItems: 1, maxItems: 500,
        items: {
          type: 'object',
          properties: {
            sceneId: { type: 'string', maxLength: 256 },
            assetId: { type: 'string', maxLength: 256 },
          },
          required: ['sceneId', 'assetId'],
        },
      },
      confirmVoiceRights: bool(),
      assignment: { type: 'string', enum: ['order', 'match'] },
      includeCaptions: bool(),
      replaceTimeline: bool(),
      maxCaptionChars: boundedInt(10, 500),
      photoMotion: { type: 'string', enum: ['auto', 'none'] },
      transitionFrames: boundedInt(0, 240),
      includeVideos: bool(),
      mediaByScene: { type: 'object' },
    }, ['narrations', 'confirmVoiceRights', 'assignment', 'includeCaptions', 'replaceTimeline']),
  },
  {
    name: 'autoedit_measure',
    description: `${WRITE} Mide los videos listos del proyecto (escenas, silencios, negros, energía de audio, subtítulos incrustados y transcripción opcional con transcribe=true) y genera las variantes del montaje automático. La medición queda en sesión para autoedit_variants y autoedit_apply.`,
    inputSchema: obj({
      assetIds: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      sceneThreshold: boundedNum(0, 1),
      silenceDb: boundedNum(-80, 0),
      minSilence: boundedNum(0.05, 10),
      transcribe: bool('Transcribe con Whisper local (tarda; sin modelo falla con aviso por fuente).'),
      useEmbeddedCaptions: bool('Extrae subtítulos incrustados del contenedor (por defecto true).'),
      recipe: {
        type: 'object',
        properties: {
          cutSeconds: boundedNum(0.8, 12),
          targetSeconds: boundedNum(0, 1800),
          zoom: boundedNum(0, 100),
          transition: { type: 'string', enum: ['none', 'dissolve', 'fade'] },
          hook: bool(),
          speechCuts: bool(),
        },
      },
    }),
  },
  {
    name: 'autoedit_variants',
    description: `${READ} Regenera las variantes del montaje automático con otra receta (recipe) sin volver a medir el material. Requiere una sesión previa de autoedit_measure sobre el proyecto abierto.`,
    inputSchema: obj({
      recipe: {
        type: 'object',
        properties: {
          cutSeconds: boundedNum(0.8, 12),
          targetSeconds: boundedNum(0, 1800),
          zoom: boundedNum(0, 100),
          transition: { type: 'string', enum: ['none', 'dissolve', 'fade'] },
          hook: bool(),
          speechCuts: bool(),
        },
      },
    }),
  },
  {
    name: 'autoedit_apply',
    description: `${WRITE} Aplica una variante del montaje automático a la timeline del proyecto (variantId de autoedit_measure/autoedit_variants; cuts opcional filtra por índices). Reemplaza la timeline por defecto; replace=false la agrega al final.`,
    inputSchema: obj({
      variantId: str('Id de la variante, p. ej. el devuelto por autoedit_measure.'),
      cuts: { type: 'array', items: boundedInt(0, 499), maxItems: 500 },
      replace: bool('true (defecto) reemplaza la timeline; false agrega al final.'),
      improveAudio: bool('High-pass, denoise, compressor y gain según loudness medido (defecto true).'),
      addCaptions: bool('Quema los subtítulos de la variante (defecto true).'),
    }, ['variantId']),
  },
  {
    name: 'autoedit_status',
    description: `${READ} Estado de la sesión de montaje automático del proyecto abierto: fuentes medidas (con escenas/silencios/negros/freezes/transcripción), variantes disponibles y si algún material medido ya no está en el proyecto. No exige sesión: devuelve measured=false si no hay ninguna.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'autoedit_export',
    description: `Genera MP4 en lote de variantes del montaje automático en outputDir (por defecto <raíz del proyecto>\\variantes-auto): monta cada variante sobre una copia del proyecto, escribe el .editoria.json y renderiza verificado. cuts (opcional) filtra los índices de corte exportados de cada variante. No toca el proyecto abierto ni permite undo. Requiere sesión de autoedit_measure.`,
    inputSchema: obj({
      outputDir: str('Carpeta de salida para los MP4 y los .editoria.json de variante.'),
      variantIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      cuts: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 200 },
      improveAudio: bool('Cadena de audio medida (defecto true).'),
      addCaptions: bool('Quema subtítulos cuando la variante los tiene (defecto true).'),
    }),
  },
  {
    name: 'director_apply',
    description: `${WRITE} Director automático completo sobre un asset de video: analyzeMedia + transcripción → plan de cortes (silencios, retakes, fillers, black/freeze) → applyDirectorPlan. Devuelve métricas del plan y hallazgos de calidad.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      platform: { type: 'string', enum: ['youtube', 'shorts', 'tiktok', 'reels', 'podcast', 'broadcast'] },
      removeSilences: bool(), removeRetakes: bool(), removeFillers: bool(),
      removeBadFrames: bool(), splitScenes: bool(), enhanceAudio: bool(),
      normalizeLoudness: bool(), autoCaptions: bool(), autoColor: bool(),
    }, ['assetId', 'platform']),
  },
  {
    name: 'beat_detect',
    description: `${READ} Detecta el pulso musical de un asset de audio/video (bpm, beats en segundos, confianza). Decodifica el audio real.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['assetId']),
  },
  {
    name: 'beat_cut_track',
    description: `${WRITE} Corta una pista de video al ritmo de un clip de audio: detecta beats del asset, planifica cortes (stride = cada N pulsos) y splitea la pista destino.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256, description: 'clip de audio con fuente asset' },
      trackId: { type: 'string', maxLength: 256, description: 'pista video destino; default: la superior desbloqueada' },
      stride: boundedInt(1, 16, 'cada N pulsos (4 = 1 corte por compás en 4/4)'),
      minGapFrames: boundedInt(1, 10000),
    }, ['clipId']),
  },
  {
    name: 'beat_ramp_suggest',
    description: `${READ} Sugiere una speed curve (slow-motion en los pulsos) para un clip de video a partir de los beats de su audio. No aplica: devuelve la curva para revisar.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      slowSpeed: boundedNum(0.1, 0.95),
      dipSeconds: boundedNum(0.2, 5),
      minGapSeconds: boundedNum(0.1, 5),
      samples: boundedInt(8, 48),
    }, ['clipId']),
  },
  {
    name: 'motion_templates_list',
    description: `${READ} Lista las plantillas de motion graphics (título, identidad, cierre, dato, fondo) con sus campos editables. Usar con motion_graphic_add.`,
    inputSchema: obj({}),
  },
  {
    name: 'motion_graphic_add',
    description: `${WRITE} Agrega cualquier motion template (ver motion_templates_list) al timeline en atFrame durante durationFrames. props se validan contra el schema de la plantilla.`,
    inputSchema: obj({
      templateId: { type: 'string', minLength: 1, maxLength: 128 },
      props: { type: 'object', description: 'props según fields de la plantilla' },
      atFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
      durationFrames: { type: 'integer', minimum: 1, maximum: 100000000 },
      trackId: { type: 'string', maxLength: 256 },
      label: { type: 'string', maxLength: 200 },
    }, ['templateId', 'props', 'atFrame', 'durationFrames']),
  },
  {
    name: 'storyboard_build',
    description: `${WRITE} Arma un storyboard/slideshow en el timeline: imágenes (por orden de label) + audio opcional, con photoMotion y transiciones. Reemplaza/usa pistas nuevas.`,
    inputSchema: obj({
      imageAssetIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 256 } },
      audioAssetId: { type: 'string', maxLength: 256 },
      defaultImageSeconds: boundedNum(0.5, 60),
      photoMotion: { type: 'string', enum: ['auto', 'none'] },
      transitionFrames: boundedInt(0, 240),
    }, ['imageAssetIds']),
  },
  {
    name: 'image_traits',
    description: `${READ} Analiza un asset imagen/video: devuelve rasgos visuales (luma, saturación, color, temperatura, orientación) + descripción textual + score contra una oración opcional.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      sentence: { type: 'string', maxLength: 2000, description: 'oración para scoreImage (opcional)' },
    }, ['assetId']),
  },
  {
    name: 'visual_plan_assignments',
    description: `${READ} Asigna imágenes a oraciones del guion por relevancia visual (planImageAssignments). Devuelve pares sentenceIndex↔assetId.`,
    inputSchema: obj({
      sentences: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 2000 } },
      imageAssetIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 256 } },
      openWithWide: bool(),
      reusePenalty: boundedNum(0, 10),
      duplicateThreshold: boundedNum(0, 1),
    }, ['sentences', 'imageAssetIds']),
  },
  {
    name: 'project_quality_evaluate',
    description: `${READ} Evalúa la calidad del proyecto: findings con severidad (timeline vacía, duraciones, clips sin media, etc.).`,
    inputSchema: obj({}),
  },
  {
    name: 'platform_rules_list',
    description: `${READ} Lista los packs de reglas de plataforma built-in (youtube, tiktok, etc.) con orientación, duraciones y requisitos.`,
    inputSchema: obj({}),
  },
  {
    name: 'platform_rules_audit',
    description: `${READ} Audita el proyecto contra un pack de reglas de plataforma (packId de platform_rules_list). Devuelve findings.`,
    inputSchema: obj({
      packId: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['packId']),
  },
  {
    name: 'title_templates_list',
    description: `${READ} Lista las plantillas de título con estilo (fuente, tamaño, color, posición) para usar con caption_title_add/motion_graphic_add.`,
    inputSchema: obj({}),
  },
  {
    name: 'speed_ramp_presets',
    description: `${READ} Lista los presets de rampa de velocidad (heroe, montaje-ritmico, congela-y-sigue...) con sus tramos. Usar con speed_ramp_preset_apply.`,
    inputSchema: obj({}),
  },
  {
    name: 'effect_presets_list',
    description: `${READ} Lista los presets de efectos de imagen (soft, dream, etc.) con sus settings ClipEffects. Usar con effect_preset_apply.`,
    inputSchema: obj({}),
  },
  {
    name: 'audio_presets_list',
    description: `${READ} Lista los presets de audio (voz clara, etc.) con sus settings. Relacionado con audio_preset_apply_all.`,
    inputSchema: obj({}),
  },
  {
    name: 'safe_area_presets',
    description: `${READ} Lista los presets de safe area (márgenes UI de plataformas) con sus puntos.`,
    inputSchema: obj({}),
  },
  {
    name: 'clip_source_info',
    description: `${READ} Devuelve info de la fuente del clip en un frame local: frame de origen, si está revertido, velocidad y proxy de preview.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      localFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, ['clipId']),
  },
  {
    name: 'director_memory_get',
    description: `${READ} Devuelve la memoria del director: perfiles calibrados por plataforma, corrida pendiente y métricas.`,
    inputSchema: obj({}),
  },
  {
    name: 'render_queue_status',
    description: `${READ} Estado de la cola de render persistida (pending/running/done/error/cancelled + resumen).`,
    inputSchema: obj({}),
  },
  {
    name: 'project_io_range_get',
    description: `${READ} Devuelve el rango in/out points actual del proyecto para exportación.`,
    inputSchema: obj({}),
  },
  {
    name: 'subtitles_export_content',
    description: `${READ} Serializa los captions actuales del proyecto a srt|vtt|ass y devuelve el contenido (sin guardar).`,
    inputSchema: obj({
      format: { type: 'string', enum: ['srt', 'vtt', 'ass'] },
    }, ['format']),
  },
  {
    name: 'catalog_favorites_list',
    description: `${READ} Lista los favoritos del catálogo (effect|transition|look|template).`,
    inputSchema: obj({}),
  },
  {
    name: 'video_format_presets',
    description: `${READ} Lista presets de fps (23.976..120) y formatos de video. Usar con project_retime.`,
    inputSchema: obj({}),
  },
  {
    name: 'project_io_range_set',
    description: `${WRITE} Define/borra los in/out points del proyecto (inFrame/outFrame absolutos; null borra).`,
    inputSchema: obj({
      inFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
      outFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, []),
  },
  {
    name: 'project_title_card_apply',
    description: `${WRITE} Aplica la tarjeta de título automática al inicio (título del proyecto + primer caption) como motion graphic.`,
    inputSchema: obj({}),
  },
  {
    name: 'speed_ramp_preset_apply',
    description: `${WRITE} Aplica un preset de rampa de velocidad a un clip (divide en tramos y aplica velocidades). Devuelve clipIds resultantes.`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      presetId: { type: 'string', enum: ['heroe', 'montaje-ritmico', 'congela-y-sigue', 'entrada-lenta', 'salida-rapida', 'tiempo-bala'] },
    }, ['clipId', 'presetId']),
  },
  {
    name: 'effect_preset_apply',
    description: `${WRITE} Aplica un preset de efectos de imagen a un clip (conserva fades/LUT existentes).`,
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      presetId: { type: 'string', minLength: 1, maxLength: 64 },
    }, ['clipId', 'presetId']),
  },
  {
    name: 'project_retime',
    description: `${WRITE} Retimea el proyecto a otro frame rate (num/den, ej. 30000/1001 para 29.97). Ajusta duración de clips.`,
    inputSchema: obj({
      num: { type: 'integer', minimum: 1, maximum: 240000 },
      den: { type: 'integer', minimum: 1, maximum: 1001 },
    }, ['num', 'den']),
  },
  {
    name: 'catalog_favorite_toggle',
    description: `${WRITE} Activa/desactiva un favorito del catálogo (kind: effect|transition|look|template, id del item).`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['effect', 'transition', 'look', 'template'] },
      id: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['kind', 'id']),
  },
  {
    name: 'render_queue_enqueue',
    description: `${WRITE} Encola perfiles de render (ids de export_profiles) con/sin captions en la cola persistida.`,
    inputSchema: obj({
      profileIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', maxLength: 256 } },
      includeCaptions: bool(),
    }, ['profileIds']),
  },
  {
    name: 'render_queue_move',
    description: `${WRITE} Mueve una entrada pending de la cola un lugar (direction up|down) — cambia qué render sigue. Sólo afecta pendientes del proyecto abierto.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 256 },
      direction: { type: 'string', enum: ['up', 'down'] },
    }, ['id', 'direction']),
  },
  {
    name: 'render_queue_retry',
    description: `${WRITE} Devuelve una entrada error/done/cancelled de la cola a pending conservando su posición.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['id']),
  },
  {
    name: 'render_queue_remove',
    description: `${WRITE} Elimina una entrada de la cola (pending/settled; una running no se puede quitar).`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['id']),
  },
  {
    name: 'render_queue_clear_settled',
    description: `${WRITE} Limpia las entradas terminadas (done/error/cancelled) de la cola de render.`,
    inputSchema: obj({}),
  },
  {
    name: 'director_outcome_record',
    description: `${WRITE} Registra el resultado de la corrida del director en la memoria (aprendizaje por plataforma). exported=true si ya se exportó.`,
    inputSchema: obj({
      exported: bool(),
    }, []),
  },
  {
    name: 'production_plan_from_project',
    description: `${READ} Construye un ProductionPlan a partir del proyecto abierto (assets, escenas, captions) para un objetivo dado.`,
    inputSchema: obj({
      objective: { type: 'string', minLength: 1, maxLength: 2000 },
    }, ['objective']),
  },
  {
    name: 'factory_variants_plan',
    description: `${READ} Planifica N variantes de video para un tema (factory de contenido): nombre y brief por variante.`,
    inputSchema: obj({
      topic: { type: 'string', minLength: 1, maxLength: 500 },
      variants: { type: 'integer', minimum: 1, maximum: 20 },
      scenes: { type: 'integer', minimum: 1, maximum: 12 },
      language: { type: 'string', maxLength: 16 },
      width: { type: 'integer', minimum: 16, maximum: 7680 },
      height: { type: 'integer', minimum: 16, maximum: 7680 },
      fpsNum: { type: 'integer', minimum: 1, maximum: 240000 },
      fpsDen: { type: 'integer', minimum: 1, maximum: 1001 },
    }, ['topic', 'variants']),
  },
  {
    name: 'publication_metadata',
    description: `${READ} Metadatos de publicación del proyecto: título, descripción, hashtags, capítulos y plataformas sugeridas.`,
    inputSchema: obj({}),
  },
  {
    name: 'publication_audit',
    description: `${READ} Auditoría de publicación: checks de licencias, duplicados, assets listos, origen IA y score de readiness.`,
    inputSchema: obj({}),
  },
  {
    name: 'effect_templates_list',
    description: `${READ} Lista plantillas de efectos: builtins (video/audio) y personalizadas guardadas. Cada una tiene su EffectStack.`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['video', 'audio'] },
    }, []),
  },
  {
    name: 'project_search',
    description: `${READ} Busca en el proyecto (clips, captions, markers, assets, escenas) con índice full-text. Devuelve hits con score y destino.`,
    inputSchema: obj({
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, ['query']),
  },
  {
    name: 'caption_motion_presets',
    description: `${READ} Lista los presets de animación de captions (fade, zoom, slide-left/right, zoom-out).`,
    inputSchema: obj({}),
  },
  {
    name: 'delivery_package_build',
    description: `${WRITE} Genera el paquete de entrega .zip (proyecto portable + subtitulos.srt + derechos.csv + manifiesto.json) y lo guarda en outputDir (default: carpeta del proyecto).`,
    inputSchema: obj({
      outputDir: { type: 'string', minLength: 1, maxLength: 1024 },
    }, []),
  },
  {
    name: 'subtitle_import',
    description: `${WRITE} Importa subtítulos desde texto (srt/vtt/ass detectado por contenido) al proyecto. Devuelve cues agregados, omitidos y warnings.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 2000000 },
      name: { type: 'string', maxLength: 256 },
      styleId: { type: 'string', maxLength: 256 },
    }, ['text']),
  },
  {
    name: 'folder_timeline_build',
    description: `${WRITE} Monta en el timeline los assets de imagen/video/audio listos del proyecto (carpeta de material), con disolvencias entre imágenes.`,
    inputSchema: obj({
      imageFrames: { type: 'integer', minimum: 2, maximum: 100000 },
      fadeFrames: { type: 'integer', minimum: 0, maximum: 100000 },
    }, []),
  },
  {
    name: 'auto_cleanup_run',
    description: `${WRITE} Limpieza automática completa: recorta silencios y pausas (con thresholds), cierra gaps, denoise, loudness a targetLufs y zoom cuts en los cortes. Devuelve reporte con proyecto aplicado.`,
    inputSchema: obj({
      closeGaps: bool(),
      cutSilences: bool(),
      silenceThresholdDb: boundedNum(-80, 0),
      silenceMinSeconds: boundedNum(0.05, 10),
      silencePaddingSeconds: boundedNum(0, 2),
      cutPauses: bool(),
      pauseMinSeconds: boundedNum(0.05, 10),
      pausePaddingSeconds: boundedNum(0, 2),
      denoise: { type: 'string', enum: ['off', 'light', 'medium', 'strong'] },
      levelAudio: bool(),
      targetLufs: boundedNum(-33, -9),
      zoomCuts: bool(),
      zoomIntensity: boundedNum(0.02, 0.3),
    }, []),
  },
  {
    name: 'effect_template_apply',
    description: `${WRITE} Aplica una plantilla de efectos (builtin o personalizada, por nombre) al stack de efectos de un clip. target: video (default) o audio.`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 200 },
      kind: { type: 'string', enum: ['video', 'audio'] },
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
      target: { type: 'string', enum: ['video', 'audio'] },
    }, ['name', 'clipId']),
  },
  {
    name: 'color_looks_list',
    description: `${READ} Lista los looks de color predefinidos (neutro, cálido, frío, cine...) con sus ClipEffects. Usar con color_look_apply.`,
    inputSchema: obj({}),
  },
  {
    name: 'export_presets_list',
    description: `${READ} Lista los presets de exportación guardados por el usuario (perfil + compresión + GPU).`,
    inputSchema: obj({}),
  },
  {
    name: 'export_size_estimate',
    description: `${READ} Estima el peso del archivo exportado en bytes (~0.13 bits/píxel de video + audio). Args opcionales; defaults del proyecto.`,
    inputSchema: obj({
      width: { type: 'integer', minimum: 2, maximum: 16384 },
      height: { type: 'integer', minimum: 2, maximum: 16384 },
      fps: boundedNum(0.1, 240),
      audioBitsPerSecond: { type: 'integer', minimum: 0, maximum: 100000000 },
      durationSeconds: boundedNum(0.01, 86400),
      videoBitsPerPixel: boundedNum(0.001, 16),
    }, []),
  },
  {
    name: 'grade_presets_list',
    description: `${READ} Lista las plantillas de gradación de color guardadas (grafos ColorGrade) y los builtin looks. Usar con grade_preset_apply.`,
    inputSchema: obj({}),
  },
  {
    name: 'sfx_add',
    description: `${WRITE} Monta un efecto de sonido de la biblioteca en la timeline como clip de audio (importa el WAV si hace falta, dedupe por provider sfx). sfxId de sfx_library o file.`,
    inputSchema: obj({
      sfxId: { type: 'string', minLength: 1, maxLength: 256 },
      file: { type: 'string', minLength: 1, maxLength: 512 },
      atFrame: { type: 'integer', minimum: 0, maximum: 100000000 },
    }, []),
  },
  {
    name: 'color_look_apply',
    description: `${WRITE} Aplica un look de color predefinido (color_looks_list) a un clip, o al look global del proyecto si no se pasa clipId.`,
    inputSchema: obj({
      lookId: { type: 'string', minLength: 1, maxLength: 64 },
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['lookId']),
  },
  {
    name: 'export_preset_save',
    description: `${WRITE} Guarda un preset de exportación (nombre + profileId de export_profiles + compresión + useGpu).`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 80 },
      profileId: { type: 'string', minLength: 1, maxLength: 256 },
      compression: { type: 'string', enum: ['equilibrado', 'rapido', 'compacto', 'maximo', 'custom'] },
      useGpu: bool(),
    }, ['name', 'profileId', 'compression']),
  },
  {
    name: 'export_preset_delete',
    description: `${WRITE} Elimina un preset de exportación guardado por id.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['id']),
  },
  {
    name: 'grade_preset_save',
    description: `${WRITE} Guarda una plantilla de gradación de color (grafo ColorGrade completo, validado) con nombre. Reemplaza una existente del mismo nombre.`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 60 },
      grade: { type: 'object' },
    }, ['name', 'grade']),
  },
  {
    name: 'grade_preset_delete',
    description: `${WRITE} Elimina una plantilla de gradación por id.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['id']),
  },
  {
    name: 'grade_preset_apply',
    description: `${WRITE} Aplica el grafo ColorGrade de una plantilla guardada (por id o nombre) al colorGrade de un clip.`,
    inputSchema: obj({
      preset: { type: 'string', minLength: 1, maxLength: 200 },
      clipId: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['preset', 'clipId']),
  },
  {
    name: 'transcribe_project',
    description: `${WRITE} Transcribe todos los clips transcribibles del proyecto y genera sus captions (guarda el proyecto primero). Devuelve resumen por clip.`,
    inputSchema: obj({
      language: { type: 'string', maxLength: 16 },
      model: { type: 'string', maxLength: 64 },
    }, []),
  },
  {
    name: 'file_url_absolute',
    description: `${READ} Convierte una ruta absoluta del proyecto en URL cargable (mediaUrl/absoluteFileUrl). Vacío fuera de la app nativa.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['path']),
  },
  {
    name: 'audio_import_bytes',
    description: `${WRITE} Importa audio binario al proyecto desde base64 (voz grabada, TTS, blobs). Formatos: wav/mp3/m4a/aac/flac/ogg/opus/webm, máx ~48MB. Devuelve assets importados.`,
    inputSchema: obj({
      fileName: { type: 'string', minLength: 1, maxLength: 120 },
      dataBase64: { type: 'string', minLength: 1, maxLength: 64_000_000 },
      fpsNum: { type: 'integer', minimum: 1, maximum: 240000 },
      fpsDen: { type: 'integer', minimum: 1, maximum: 1001 },
    }, ['fileName', 'dataBase64']),
  },
  {
    name: 'media_copy_into',
    description: `${WRITE} Copia archivos de media a un directorio de destino y devuelve ruta relativa + sha256 de cada uno (integridad real del destino).`,
    inputSchema: obj({
      paths: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 32_768 } },
      directory: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['paths', 'directory']),
  },
  {
    name: 'alpha_frames_write',
    description: `${WRITE} Escribe un lote de frames PNG RGBA (base64) de una secuencia temporal bajo un token. Usar junto a alpha_frames_to_asset para generar video con alfa (motion graphics, Lottie).`,
    inputSchema: obj({
      token: { type: 'string', minLength: 1, maxLength: 128 },
      startIndex: { type: 'integer', minimum: 0, maximum: 1000000 },
      frames: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'string', minLength: 1, maxLength: 8_000_000 } },
    }, ['token', 'startIndex', 'frames']),
  },
  {
    name: 'alpha_frames_to_asset',
    description: `${WRITE} Codifica la secuencia de frames alfa (token) como WebM VP9 con transparencia, la importa al proyecto y la marca ready. Requiere alpha_frames_write previo.`,
    inputSchema: obj({
      token: { type: 'string', minLength: 1, maxLength: 128 },
      label: { type: 'string', minLength: 1, maxLength: 200 },
      width: { type: 'integer', minimum: 2, maximum: 8192 },
      height: { type: 'integer', minimum: 2, maximum: 8192 },
      frameCount: { type: 'integer', minimum: 1, maximum: 100000 },
      fpsNum: { type: 'integer', minimum: 1, maximum: 240000 },
      fpsDen: { type: 'integer', minimum: 1, maximum: 1001 },
    }, ['token', 'label', 'width', 'height', 'frameCount', 'fpsNum', 'fpsDen']),
  },
  {
    name: 'alpha_frames_discard',
    description: `${WRITE} Descarta los frames temporales de una secuencia alfa (token) cuando la conversión no termina.`,
    inputSchema: obj({
      token: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['token']),
  },
  {
    name: 'clip_effects',
    description: `${WRITE} Velocidad o reproducción inversa de un clip.`,
    inputSchema: {
      ...obj({
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        speed: boundedNum(0.1, 4),
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
    description: 'Exporta EDL, OTIO, FCPXML, FCP7XML, AAF u OMF para otro editor (AAF/OMF/FCP7 van por filmcraft-interchange).',
    inputSchema: obj(
      {
        format: { type: 'string', enum: ['edl', 'otio', 'fcpxml', 'fcp7xml', 'aaf', 'omf'] },
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
        scenes: boundedInt(1, 12),
        width: boundedInt(2, 7680),
        height: boundedInt(2, 4320),
        language: { type: 'string', minLength: 2, maxLength: 12 },
        render: bool(),
        generateMedia: bool('genera los visuales con Flow en vez de usar assets del proyecto'),
        flowServerId: { type: 'string', maxLength: 128, description: 'Servidor MCP de Flow configurado (ver mcp_list).' },
        flowKind: { type: 'string', enum: ['image', 'video'] },
        flowModel: { type: 'string', maxLength: 120 },
        flowRatio: { type: 'string', maxLength: 16 },
        flowDuration: { type: 'string', maxLength: 16 },
        approveCredits: bool('obligatorio true cuando generateMedia está activo'),
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
    inputSchema: obj({ limit: boundedInt(1, 50) }),
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
    description: `${READ} Lista medios (imagen/audio/video) con ruta, tipo y tamaño. Acepta ruta absoluta, «Descargas»/«Downloads» (la carpeta misma) o nombre de subcarpeta dentro de Descargas; 2 niveles, máx. 300. Carpeta existente sin medios devuelve count 0. Usala antes de asset_import.`,
    inputSchema: obj({
      folder: { type: 'string', minLength: 1, maxLength: 32_768 },
      root: { type: 'string', maxLength: 32_768 },
    }, ['folder']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'media_search',
    description: `${READ} Busca medios por nombre (substring, sin mayúsculas) hasta 4 niveles, tope 200 («truncated»). Acepta ruta absoluta, «Descargas»/«Downloads» o subcarpeta de Descargas. Usala antes de asset_import.`,
    inputSchema: obj({
      folder: { type: 'string', minLength: 1, maxLength: 32_768 },
      query: { type: 'string', minLength: 1, maxLength: 200 },
      kind: { type: 'string', enum: ['image', 'audio', 'video'] },
      root: { type: 'string', maxLength: 32_768 },
    }, ['folder', 'query']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_list',
    description: `${READ} Lista el contenido de una carpeta del disco (subcarpetas primero) con ruta, tipo y tamaño, sin recursión. Tope 500. Usala para explorar el disco antes de importar.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_read',
    description: `${READ} Lee el contenido de texto de un archivo de la PC (subtítulos, proyectos .editoria.json, CSV, etc.). Devuelve el texto completo hasta 512 KiB; si es más grande viene truncado. No interpreta binarios.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'fs_write',
    description: `${WRITE} Escribe texto en un archivo de la PC (lo crea si no existe, junto con las carpetas padre). Sirve para guiones, subtítulos, scripts, JSON de proyecto, configs — cualquier texto hasta 10 MiB.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      content: { type: 'string', maxLength: 10_485_760 },
    }, ['path', 'content']),
  },
  {
    name: 'fs_mkdir',
    description: `${WRITE} Crea una carpeta en la PC (con todas las carpetas padre por defecto).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      recursive: { type: 'boolean' },
    }, ['path']),
  },
  {
    name: 'fs_delete',
    description: `${WRITE} Borra un archivo o carpeta de la PC. Las carpetas con contenido exigen recursive=true explícito y confirm=true para cualquier borrado. Rechaza rutas protegidas (raíz de unidad, Windows, Program Files).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      recursive: { type: 'boolean' },
      confirm: { type: 'boolean' },
    }, ['path', 'confirm']),
  },
  {
    name: 'fs_move',
    description: `${WRITE} Mueve o renombra un archivo/carpeta de la PC a otra ruta. El destino no debe existir (no sobrescribe); puede cruzar carpetas del mismo disco.`,
    inputSchema: obj({
      from: { type: 'string', minLength: 1, maxLength: 32_768 },
      to: { type: 'string', minLength: 1, maxLength: 32_768 },
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
    description: `${WRITE} Aísla la voz de un audio/video del disco con Demucs y devuelve vocals.wav + accompaniment.wav. Requiere Python+demucs (la 1ª vez baja ~2 GB de modelo); operación lenta.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio o video.' },
      model: { type: 'string', maxLength: 64, description: 'Modelo Demucs (por defecto htdemucs).' },
      quality: { type: 'string', enum: ['low', 'medium', 'high', 'best'], description: 'Calidad vs velocidad (por defecto medium).' },
    }, ['path']),
  },
  {
    name: 'voice_isolation_prepare',
    description: `${WRITE} Genera (o reutiliza) vocals.wav de un asset de audio/video del proyecto abierto; los clips con voiceIsolation lo usan al exportar. Requiere Python+demucs.`,
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
    description: `${WRITE} Abre (o reutiliza) una sesión del navegador embebido y navega a una URL http(s). Sin «slot» abre Flow; con «slot» abre cualquier web en ventana propia (varias webs a la vez, cada una con su CDP). Para control total usá el CDP de web_sessions_status con Playwright.`,
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
    description: `${WRITE} Ejecuta JavaScript en una sesión del navegador embebido y devuelve el resultado serializado (JSON; «slot» para elegir, por defecto Flow). Para clicks/descargas usá el CDP de web_sessions_status.`,
    inputSchema: obj({
      js: { type: 'string', maxLength: 65_536, description: 'Código JavaScript a evaluar en la página.' },
      slot: { type: 'string', maxLength: 32, description: 'Sesión (por defecto "flow").' },
    }, ['js']),
  },
  {
    name: 'flow_generate_image',
    description: `${WRITE} Genera imágenes en Google Flow de forma autónoma sobre la sesión web embebida: envía el prompt, espera y descarga las imágenes a outputDir. Requiere sesión de Google activa y Node.js >= 22. Devuelve rutas listas para asset_import.`,
    inputSchema: obj({
      prompt: { type: 'string', minLength: 1, maxLength: 4000, description: 'Prompt para Flow.' },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Carpeta absoluta de salida.' },
      slot: { type: 'string', maxLength: 32 },
      url: { type: 'string', maxLength: 2_048 },
      timeoutSecs: { type: 'integer', minimum: 60, maximum: 3600 },
      reuseProject: { type: 'boolean' },
    }, ['prompt', 'outputDir']),
  },
  {
    name: 'flow_generate_assets',
    description: `${WRITE} Genera imágenes en Flow para varios prompts seguidos (una sesión, cola secuencial), descarga todo a outputDir e importa los archivos al proyecto. Ideal para ilustrar un guion por escenas. Requiere sesión de Flow activa.`,
    inputSchema: obj({
      prompts: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: { type: 'string', minLength: 1, maxLength: 4000 },
      },
      outputDir: { type: 'string', maxLength: 32_768 },
      importToProject: { type: 'boolean' },
      timeoutSecs: { type: 'integer', minimum: 60, maximum: 3600 },
    }, ['prompts']),
  },

  {
    name: 'screen_record',
    description: `${WRITE} Graba y/o streamea video estilo OBS a MP4/RTMP: pantalla completa/ventana/región, webcam en PiP y micrófono. action=start (outputDir, fps, captureTarget, windowTitle, region*, webcamDevice, webcamChroma, cursorOverlay, audioDevice, streamUrl, captureScreen, encoder), stop devuelve ruta+medidas, status estado+bytes en vivo, devices lista fuentes, snapshot captura UN frame PNG de la misma configuración de fuentes (sin grabar) para inspección visual.`,
    inputSchema: obj({
      action: { type: 'string', enum: ['start', 'stop', 'status', 'devices', 'snapshot'] },
      outputDir: { type: 'string', maxLength: 32_768 },
      fps: boundedInt(1, 60),
      captureTarget: { type: 'string', enum: ['desktop', 'window', 'region'] },
      windowTitle: { type: 'string', maxLength: 300 },
      regionX: boundedInt(-100_000, 100_000),
      regionY: boundedInt(-100_000, 100_000),
      regionWidth: boundedInt(16, 7680),
      regionHeight: boundedInt(16, 4320),
      webcamDevice: { type: 'string', maxLength: 200 },
      webcamChroma: {
        type: 'object',
        description: 'Chroma key de la webcam antes del PiP (requiere webcamDevice).',
        properties: {
          color: { type: 'string', maxLength: 7, description: '#RRGGBB del color a eliminar.' },
          similarity: { type: 'number', minimum: 0, maximum: 1 },
          blend: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['color', 'similarity', 'blend'],
      },
      cursorOverlay: {
        type: 'object',
        description: 'Quema el cursor del sistema en la grabación (estilo/escala/color/ripple).',
        properties: {
          style: { type: 'string', enum: ['flecha', 'punto', 'cruz', 'cheia', '3d'] },
          color: { type: 'string', enum: ['blanco', 'negro', 'amarillo', 'verde'] },
          scale: { type: 'number', enum: [0.5, 1, 2] },
          ripple: { type: 'boolean' },
        },
        required: ['style', 'color', 'scale', 'ripple'],
      },
      audioDevice: { type: 'string', maxLength: 200 },
      streamUrl: { type: 'string', maxLength: 2048, description: 'URL rtmp(s):// para streamear a la vez que grabar (OBS).' },
      encoder: { type: 'string', enum: ['x264', 'nvenc', 'qsv', 'amf', 'mf'], description: 'Codificador H.264; nvenc/qsv/amf usan hardware.' },
      captureScreen: { type: 'boolean' },
    }, ['action']),
  },

  {
    name: 'stickman_render',
    description: `${WRITE} Genera un video MP4 real de un personaje stickman articulado (rig 2D con huesos FK). action implícita por parámetros: action=idle|walk|run|wave|jump, o keyframes=[{frame, ...pose}] para animación personalizada con interpolación lineal. particles.kind: confetti|snow|sparks|bounce|tumble (tumble = cuerpos rígidos rotados con spin). Devuelve ruta, frames, fps y medidas ffprobe verificadas.`,
    inputSchema: obj({
      outputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      action: { type: 'string', enum: ['idle', 'walk', 'run', 'wave', 'jump'] },
      durationSeconds: { type: 'number', minimum: 0.5, maximum: 120 },
      fps: boundedInt(1, 60),
      width: boundedInt(64, 1920),
      height: boundedInt(64, 1080),
      boneHex: { type: 'string', maxLength: 7, description: 'Color del cuerpo #RRGGBB.' },
      bgHex: { type: 'string', maxLength: 7, description: 'Color de fondo #RRGGBB.' },
      particles: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['confetti', 'snow', 'sparks', 'bounce', 'tumble'] },
          count: boundedInt(1, 2000),
          colorHex: { type: 'string', maxLength: 7 },
          gravity: { type: 'number', minimum: 0, maximum: 5000, description: 'px/s², solo bounce/tumble.' },
          bounce: { type: 'number', minimum: 0, maximum: 1, description: 'Restitución 0..1, solo bounce/tumble.' },
          spin: { type: 'number', minimum: -8, maximum: 8, description: 'Escala de velocidad angular, solo tumble (-8..8).' },
        },
      },
      keyframes: {
        type: 'array',
        maxItems: 500,
        items: {
          type: 'object',
          properties: {
            frame: { type: 'integer', minimum: 0 },
            spine: { type: 'number' }, head: { type: 'number' },
            upperArmL: { type: 'number' }, foreArmL: { type: 'number' },
            upperArmR: { type: 'number' }, foreArmR: { type: 'number' },
            thighL: { type: 'number' }, shinL: { type: 'number' },
            thighR: { type: 'number' }, shinR: { type: 'number' },
            pelvisDy: { type: 'number' },
          },
          required: ['frame'],
        },
      },
    }, ['outputPath']),
  },

  {
    name: 'obs_scenes',
    description: `${WRITE} Gestiona escenas OBS persistentes (fuentes+streaming con nombre). action=list devuelve escenas guardadas; save crea/actualiza {id?, name, fps, captureTarget, windowTitle, region*, webcamDevice, audioDevice, streamUrl, encoder, captureScreen}; delete {id}; start {id, outputDir} aplica la escena y arranca grabación/streaming; preview {id} captura UN frame PNG de la escena sin grabar; transition {fromId? usa id como origen, toId, outputDir, kind?, leadSecs?, durationSecs?, tailSecs?, width?, height?, fps?, audioDevice?} renderiza un MP4 finito con una transición xfade entre dos escenas — cada una puede tener pantalla y/o webcam en PiP con chroma y la escena origen puede traer cursorOverlay (se quema en segundo pase); fade, wipe*, slide*, circle*, dissolve, pixelize, radial, smooth*); switch_start {id, outputDir, kind?, transitionSecs?, width?, height?, fps?, audioDevice?, streamUrl?, encoder?} abre una sesión de switching EN VIVO: la escena queda grabando y streameando (si hay streamUrl RTMP) y switch_scene {id} la cambia (cierra el segmento y abre otro con transiciones al final); switch_stop cose todos los segmentos con xfade/acrossfade en un MP4; switch_status devuelve escena activa, segmentos y warnings; switch_preview captura UN frame PNG del programa en vivo (la escena activa) sin tocar la sesión. encoder elige el H.264 de segmentos y cosido (x264/nvenc/qsv/amf/mf); el cursor overlay de cada escena se quema por segmento al cerrarlo (sólo escritorio completo); con streamUrl cada segmento streamea a RTMP en el mismo proceso (la conexión se renegocia por cambio de escena).`,
    inputSchema: obj({
      action: { type: 'string', enum: ['list', 'save', 'delete', 'start', 'preview', 'transition', 'switch_start', 'switch_scene', 'switch_stop', 'switch_status'] },
      id: { type: 'string', maxLength: 64 },
      toId: { type: 'string', maxLength: 64 },
      kind: { type: 'string', enum: ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose', 'diagtl', 'diagtr', 'diagbl', 'diagbr', 'hlslice', 'hrslice', 'vuslice', 'vdslice', 'dissolve', 'pixelize', 'radial', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown'] },
      leadSecs: { type: 'number', minimum: 0, maximum: 3600 },
      durationSecs: { type: 'number', minimum: 0.1, maximum: 30 },
      tailSecs: { type: 'number', minimum: 0, maximum: 3600 },
      transitionSecs: { type: 'number', minimum: 0.1, maximum: 30 },
      width: boundedInt(16, 7680),
      height: boundedInt(16, 4320),
      outputDir: { type: 'string', maxLength: 32_768 },
      name: { type: 'string', maxLength: 120 },
      fps: boundedInt(1, 60),
      captureTarget: { type: 'string', enum: ['desktop', 'window', 'region'] },
      windowTitle: { type: 'string', maxLength: 300 },
      regionX: boundedInt(-100_000, 100_000),
      regionY: boundedInt(-100_000, 100_000),
      regionWidth: boundedInt(16, 7680),
      regionHeight: boundedInt(16, 4320),
      webcamDevice: { type: 'string', maxLength: 200 },
      audioDevice: { type: 'string', maxLength: 200 },
      streamUrl: { type: 'string', maxLength: 2048 },
      encoder: { type: 'string', enum: ['x264', 'nvenc', 'qsv', 'amf', 'mf'] },
      captureScreen: { type: 'boolean' },
    }, ['action']),
  },

  {
    name: 'subtitles_translate',
    description: `${WRITE} Traduce un lote de subtítulos con el proveedor IA configurado (máx. 200 cues). Devuelve textos traducidos + providerId/model/simulated. Con proveedor mock devuelve el original marcado simulated=true.`,
    inputSchema: obj({
      texts: { type: 'array', items: { type: 'string', maxLength: 2000 }, minItems: 1, maxItems: 200 },
      sourceLanguage: { type: 'string', minLength: 2, maxLength: 16 },
      targetLanguage: { type: 'string', minLength: 2, maxLength: 16 },
      glossary: { type: 'string', maxLength: 4000 },
      approvedCost: { type: 'boolean' },
    }, ['texts', 'sourceLanguage', 'targetLanguage']),
  },

  {
    name: 'browser_instances',
    description: `${WRITE} Instancias aisladas de Chromium (Chrome/Edge) con perfil propio por ID, proxy HTTP/SOCKS5 por instancia y anti-detección (stealth JS vía CDP). action=launch {profileId, proxyUrl?, url?}, close {profileId}, list, navigate {profileId,url}, eval {profileId,expression}. Devuelve puerto CDP para control externo.`,
    inputSchema: obj({
      action: { type: 'string', enum: ['launch', 'close', 'list', 'navigate', 'eval'] },
      profileId: { type: 'string', minLength: 1, maxLength: 64 },
      proxyUrl: { type: 'string', maxLength: 300 },
      url: { type: 'string', maxLength: 2048 },
      expression: { type: 'string', maxLength: 100000 },
    }, ['action']),
  },

  {
    name: 'subtitles_pipeline',
    description: `${WRITE} Pipeline automático de subtítulos: transcribe un video con faster-whisper, traduce los cues con el proveedor IA (si targetLanguage), genera .ass y opcionalmente quema subtítulos en un MP4 nuevo (libass). Devuelve assPath, cues, translated, simulated, burned.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', maxLength: 32_768 },
      targetLanguage: { type: 'string', maxLength: 16 },
      sourceLanguage: { type: 'string', maxLength: 16 },
      model: { type: 'string', enum: ['tiny', 'base', 'small', 'medium'] },
      burn: { type: 'boolean' },
    }, ['inputPath']),
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
    description: 'Empaqueta el proyecto y sus medios en un ZIP. Con «path» escribe directo sin diálogo (uso por MCP); sin «path» abre el diálogo nativo de guardado.',
    inputSchema: obj({
      path: { type: 'string', maxLength: 32_768 },
    }),
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
        brightness: boundedNum(-1, 1),
        contrast: boundedNum(0, 3),
        saturation: boundedNum(0, 3),
        temperature: boundedNum(-1, 1),
        shadows: boundedNum(-1, 1),
        highlights: boundedNum(-1, 1),
        fade: boundedNum(0, 1),
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
        durationFrames: boundedInt(1, 120),
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
        positionX: boundedNum(0, 1),
        positionY: boundedNum(0, 1),
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
        durationFrames: boundedInt(30, 600),
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
        targetLufs: boundedNum(-33, -9),
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
        durationFrames: boundedInt(5, 60),
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
        speed: boundedNum(0.1, 4),
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
        frame: boundedInt(0, 10_000_000),
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
        intensity: boundedNum(0.1, 1),
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
        lowDb: boundedNum(-12, 12),
        midDb: boundedNum(-12, 12),
        highDb: boundedNum(-12, 12),
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
        reductionDb: boundedNum(-24, -3),
        fadeMs: boundedInt(50, 1000),
      },
      ['musicTrackId', 'voiceTrackId'],
    ),
  },

  // ── Audio profesional (filmcraft-dsp, offline) ──────────────────────
  {
    name: 'audio_effects_list',
    description: `${READ} Catálogo de efectos de audio profesionales disponibles para render offline: id, nombre, categoría y parámetros con rango/unidad/default (compressor, limiter, parametric_eq, deesser, denoise, dehum, dereverb, click_remover, speech_enhance, vocal_enhancer, convolution_reverb, mastering, graphic_eq, multiband_compressor, etc.). Consultala antes de audio_effects_render.`,
    inputSchema: obj({}),
  },
  {
    name: 'audio_effects_render',
    description: `${WRITE} Render offline de una cadena de efectos de audio profesionales sobre un archivo: decodifica estéreo 48 kHz, aplica los efectos en orden (ids de audio_effects_list con sus params) y escribe WAV float32. speed (0.1–10) aplica time-stretch WSOLA antes de los efectos. Máx. 5 min de audio.`,
    inputSchema: obj(
      {
        path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video de entrada.' },
        output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del WAV de salida (.wav).' },
        chain: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              effect: { type: 'string', minLength: 1, maxLength: 128 },
              params: {
                type: 'array',
                maxItems: 64,
                items: {
                  type: 'object',
                  properties: {
                    param: { type: 'string', minLength: 1, maxLength: 128 },
                    value: { type: 'number' },
                  },
                  required: ['param', 'value'],
                  additionalProperties: false,
                },
              },
            },
            required: ['effect'],
            additionalProperties: false,
          },
        },
        speed: boundedNum(0.1, 10),
      },
      ['path', 'output', 'chain'],
    ),
  },
  {
    name: 'audio_loudness_analyze',
    description: `${READ} Loudness BS.1770/EBU R128 de un archivo: LUFS integrado, loudness range, máximos momentary/short-term, sample peak y true peak dBTP, más duración. Usala para mastering y control de nivel antes de exportar.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video.' },
    }, ['path']),
  },
  {
    name: 'audio_sync_offset',
    description: `${READ} Offset entre dos grabaciones del mismo evento (GCC-PHAT, precisión de samples): devuelve lag en samples/segundos, confidence, distinct, inverted y reliable. Usala para alinear audio de cámaras o pistas duplicadas.`,
    inputSchema: obj({
      pathA: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del primer archivo.' },
      pathB: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del segundo archivo.' },
    }, ['pathA', 'pathB']),
  },
  {
    name: 'audio_time_stretch',
    description: `${WRITE} Time-stretch con pitch preservado (WSOLA) sobre un archivo: speed>1 acorta (más rápido), speed<1 alarga (más lento), sin cambiar el tono de voz. Salida WAV float32. Ideal para ajustar narración al tiempo del video.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video de entrada.' },
      output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del WAV de salida (.wav).' },
      speed: boundedNum(0.1, 10),
    }, ['path', 'output', 'speed']),
  },
  {
    name: 'audio_loudness_normalize',
    description: `${WRITE} Normaliza un archivo de audio a un target LUFS (EBU R128, default -14): mide el loudness real, aplica la ganancia que llega al objetivo sin pasar -1 dBTP de true peak y pasa un limiter de seguridad. Devuelve measuredLufs, targetLufs y gainDb aplicados. Salida WAV.`,
    inputSchema: obj(
      {
        path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video de entrada.' },
        output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del WAV de salida (.wav).' },
        targetLufs: boundedNum(-70, -5, 'LUFS integrado objetivo (default -14, estándar para redes sociales).'),
      },
      ['path', 'output'],
    ),
  },
  {
    name: 'audio_remix_analyze',
    description: '${READ} Análisis rítmico del archivo (motor Remix de FilmCraft): BPM detectado, cantidad de beats y posiciones de cada beat en segundos (cap 2000). Usala antes de cortar al ritmo o antes de audio_remix_render. Tope: 10 minutos de audio.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video.' },
    }, ['path']),
  },
  {
    name: 'audio_remix_render',
    description: '${WRITE} Remix automático al ritmo: detecta los beats del audio, planea saltos que minimizan la ruptura armónica y reensambla el audio a targetSeconds con crossfades de 20 ms. Salida WAV float32. segments/variations (0-100, default 50) controlan densidad de cortes y variación. Ideal para resumir música a la duración del video.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video de entrada.' },
      output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del WAV de salida (.wav).' },
      targetSeconds: boundedNum(1, 600, 'Duración objetivo del remix en segundos.'),
      segments: boundedNum(0, 100, 'Densidad de segmentos del remix (opcional, default 50).'),
      variations: boundedNum(0, 100, 'Variación de los saltos (opcional, default 50).'),
    }, ['path', 'output', 'targetSeconds']),
  },
  {
    name: 'audio_duck_plan',
    description: '${READ} Plan de sidechain ducking sobre un archivo (típicamente la voz): detecta regiones de actividad en segundos y devuelve keyframes de ganancia en dB listos para automatizar el volumen de la música, más la envolvente de nivel. Solo análisis, no escribe archivos. Usala antes de configurar audio_ducking o antes de mezclar voz con música.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video (la voz/key).' },
      sensitivity: boundedNum(0, 1, 'Sensibilidad de detección de voz (default 0.5).'),
      minOnSeconds: boundedNum(0.02, 5, 'Duración mínima de una región de voz en segundos (default 0.15).'),
      bridgeSeconds: boundedNum(0, 2, 'Puente entre regiones cercanas en segundos (default 0.3).'),
      clipStartSeconds: boundedNum(0, 600, 'Inicio de la ventana del clip en segundos (default 0).'),
      clipEndSeconds: boundedNum(0, 600, 'Fin de la ventana del clip en segundos (default fin del archivo).'),
      baseDb: boundedNum(-60, 12, 'Ganancia base en dB (default 0).'),
      reduceDb: boundedNum(-60, 0, 'Cuánto baja la música durante la voz en dB (default -12).'),
      fadeSeconds: boundedNum(0.01, 2, 'Duración de las rampas de ducking en segundos (default 0.15).'),
    }, ['path']),
  },
  {
    name: 'audio_channels_convert',
    description: '${WRITE} Conversión de layout de canales con matrices de filmcraft: mono, stereo o 5.1. fromLayout se autodetecta con ffprobe si se omite. Para 5.1→estéreo, mixdown elige el folding: front, frontRear (BS.775, default), frontLfe o frontRearLfe. Salida WAV.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de audio/video de entrada.' },
      output: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del WAV de salida (.wav).' },
      toLayout: { type: 'string', enum: ['mono', 'stereo', '5.1'], description: 'Layout de salida.' },
      mixdown: { type: 'string', enum: ['front', 'frontRear', 'frontLfe', 'frontRearLfe'], description: 'Folding 5.1→estéreo (opcional, default frontRear).' },
      fromLayout: { type: 'string', enum: ['mono', 'stereo', '5.1'], description: 'Layout de entrada si no se autodetecta (opcional).' },
    }, ['path', 'output', 'toLayout']),
  },
  {
    name: 'lut_probe',
    description: '${READ} Inspecciona una LUT .cube/.3dl sin aplicarla: formato detectado, título, tamaño de grilla (N o N³), si tiene shaper 1D y dominio de entrada/salida. Usala para validar un archivo de LUT antes de asignarlo a un clip o al look global del proyecto.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo .cube o .3dl.' },
    }, ['path']),
  },
  {
    name: 'lut_export',
    description: `${WRITE} Hornea una transformación de color en un archivo LUT .cube 3D (grilla 33³) dentro de outputDir. Parámetros: brightness (-1..1), contrast (0..3), saturation (0..3), temperature (-1..1, dobla cálido/enfría). Devuelve la ruta del .cube, bytes y tamaño de grilla — verificable con lut_probe y aplicable a clips o al look del proyecto.`,
    inputSchema: obj({
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Carpeta destino existente.' },
      title: { type: 'string', maxLength: 64, description: 'Nombre base del archivo (se sanitiza).' },
      brightness: { type: 'number', minimum: -1, maximum: 1 },
      contrast: { type: 'number', minimum: 0, maximum: 3 },
      saturation: { type: 'number', minimum: 0, maximum: 3 },
      temperature: { type: 'number', minimum: -1, maximum: 1 },
    }, ['outputDir']),
  },
  {
    name: 'lut_import',
    description: `${WRITE} Importa un archivo LUT .cube del disco al proyecto: valida el archivo, lo copia a media/luts del proyecto y devuelve la ruta relativa lista para asignar a un clip (effects.lutFile) o al look global. Con «path» salta el diálogo nativo — uso por IA.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del .cube a importar.' },
    }),
  },
  {
    name: 'video_scopes_analyze',
    description: '${READ} Scopes de video reales (motor filmcraft-scopes) sobre un frame PNG/JPG: waveform de luma, vectorscopio YUV e histograma RGB + media CB/CR. Usala para medir exposición, balance de color y clipping de un frame antes de decidir grading o detectar problemas.',
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta de la imagen del frame a analizar.' },
    }, ['path']),
  },
  {
    name: 'render_frame',
    description: 'READ Renderiza un PNG real del frame de la timeline en el tiempo indicado (mismo pipeline visual del export: pistas, look, subtítulos). Devuelve la ruta del PNG, resolución y metadatos del compuesto. Es el lazo de verificación visual: usala después de edits de color/layout/efectos para comprobar el resultado. clipId es obligatorio (usá timeline_clips para obtenerlo); frame es el número de frame del proyecto (ver project_summary para fps). composite=true compone todas las pistas (default); false aísla el clip; native=true devuelve el frame a resolución del medio sin composición.',
    inputSchema: obj({
      clipId: { type: 'string', minLength: 1, maxLength: 256, description: 'Id del clip de referencia (de timeline_clips).' },
      frame: { type: 'integer', minimum: 0, maximum: 10000000, description: 'Número de frame dentro del proyecto.' },
      composite: { type: 'boolean', description: 'Compone todas las pistas visibles (default true).' },
      native: { type: 'boolean', description: 'Frame a resolución nativa del medio, sin composición (opcional).' },
    }, ['clipId', 'frame']),
  },
  {
    name: 'tools_batch',
    description: 'DESTRUCTIVA Ejecuta varias herramientas MCP en orden dentro de una sola llamada (equivalente a command_batch de FilmCraft). Cada paso es {name, arguments}; si stop_on_error es true (default) se detiene en el primer error. Devuelve {total, ran, completed, failed, stoppedEarly, results:[{name, ok, result|error}]}. Usala para secuencias de edición en una sola round-trip (p.ej. varios clip_update + transition_add + marker_add) y para planes multi-paso. No la uses para lecturas sueltas.',
    inputSchema: obj({
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: obj({
          name: { type: 'string', minLength: 1, maxLength: 120, description: 'Nombre de la herramienta MCP a ejecutar.' },
          arguments: { type: 'object', description: 'Argumentos de esa herramienta (se validan igual que una llamada directa).' },
        }, ['name']),
      },
      stop_on_error: bool('Detener en el primer paso fallido (default true).'),
    }, ['steps']),
    annotations: { destructiveHint: true },
  },
  {
    name: 'media_thumbnail',
    description: `${READ} Genera un thumbnail (frame) de un archivo de video o imagen del disco. Devuelve la ruta del archivo imagen resultante.`,
    inputSchema: obj(
      {
        path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del medio.' },
        isImage: bool('true si el archivo es imagen estática.'),
        timeSeconds: boundedNum(0, 86_400, 'Segundo del frame para video.'),
      },
      ['path'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'scene_detect',
    description: `${READ} Detecta cortes de escena de un asset del proyecto. threshold 0-1: más alto = menos cortes.`,
    inputSchema: obj(
      {
        assetId: { type: 'string', minLength: 1, maxLength: 256 },
        threshold: boundedNum(0, 1, 'Sensibilidad del detector.'),
      },
      ['assetId', 'threshold'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'stabilization_analyze',
    description: `${READ} Analiza la estabilización de un rango de frames de un asset (vidstab): smoothing y previewProxy MP4 horneado si existe.`,
    inputSchema: obj(
      {
        assetId: { type: 'string', minLength: 1, maxLength: 256 },
        inFrame: boundedInt(0, 10_000_000),
        outFrame: boundedInt(1, 10_000_000),
        smoothing: boundedNum(0, 100, 'Suavizado vidstab.'),
      },
      ['assetId', 'inFrame', 'outFrame', 'smoothing'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sample_asset_color',
    description: `${READ} Toma el color promedio RGB de un archivo en un segundo dado.`,
    inputSchema: obj(
      {
        path: { type: 'string', minLength: 1, maxLength: 32_768 },
        seconds: boundedNum(0, 86_400),
      },
      ['path', 'seconds'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'find_missing_assets',
    description: `${READ} Lista los assets del proyecto cuya fuente falta en disco, con los clips que los usan y si tienen proxy.`,
    inputSchema: obj({ projectPath: { type: 'string', maxLength: 32_768 } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'find_duplicate_assets',
    description: `${READ} Agrupa assets con contenido idéntico (SHA-256) en el proyecto.`,
    inputSchema: obj({ projectPath: { type: 'string', maxLength: 32_768 } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'relink_assets_folder',
    description: `${WRITE} Relinkea masivamente los assets faltantes emparejando por nombre+tamaño dentro de una carpeta. Devuelve la ruta nueva de cada asset relinkeado.`,
    inputSchema: obj(
      {
        folder: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Carpeta con los archivos faltantes.' },
        projectPath: { type: 'string', maxLength: 32_768 },
      },
      ['folder'],
    ),
  },
  {
    name: 'sfx_library',
    description: `${READ} Lista los efectos de sonido disponibles (id, etiqueta, duración, grupo).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_capabilities',
    description: `${READ} Capacidades del equipo: backends de IA/proceso disponibles con estado y motivo si no están.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export_capabilities',
    description: `${READ} Capacidades del pipeline de exportación (codecs, encoders HW, formatos).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'extract_subtitles',
    description: `${READ} Extrae subtítulos embebidos de un archivo de video (devuelve SRT, idioma y título).`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mix_loudness_analyze',
    description: `${READ} Mide el loudness de la mezcla del proyecto con el grafo de audio real del export (BS.1770/EBU R128, pre-normalización).`,
    inputSchema: obj({ profileId: { type: 'string', maxLength: 256 } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'audio_scope_analyze',
    description: `${READ} Scopes de audio (oscilograma/espectro/espectrograma) de un archivo del disco o de un asset del proyecto.`,
    inputSchema: obj({
        path: { type: 'string', maxLength: 32_768, description: 'Ruta absoluta (alternativa a assetId).' },
        assetId: { type: 'string', maxLength: 256, description: 'Asset del proyecto (alternativa a path).' },
        startSeconds: boundedNum(0, 86_400),
        durationSeconds: boundedNum(0.01, 86_400),
      }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'file_loudness_measure',
    description: `${READ} Loudness de un archivo ya renderizado (LUFS integrado, true peak, LRA) — lazo cerrado de entrega.`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'voice_list',
    description: `${READ} Voces disponibles para narración (id, nombre, cultura, género).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'narration_synthesize',
    description: `${WRITE} Genera un audio de narración TTS (SAPI local) y lo importa como asset del proyecto. Devuelve el asset creado.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 20_000 },
      voice: { type: 'string', maxLength: 120 },
      provider: { type: 'string', enum: ['windows-sapi'] },
    }, ['text']),
  },
  {
    name: 'dialogue_enhance',
    description: `${WRITE} Mejora un archivo de diálogo/voz con la cadena DSP local (preset dialogo|voz|podcast|suave). Devuelve el WAV resultante.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', maxLength: 32_768 },
      preset: { type: 'string', enum: ['dialogo', 'voz', 'podcast', 'suave'] },
    }, ['inputPath']),
  },
  {
    name: 'dub_synthesize',
    description: `${WRITE} Doblaje sintético: reemplaza el audio de un video por TTS de cues dados. Devuelve el video resultante.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      language: { type: 'string', minLength: 2, maxLength: 12 },
      voice: { type: 'string', maxLength: 120 },
      cues: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: obj({
          startSeconds: boundedNum(0, 86_400),
          endSeconds: boundedNum(0, 86_400),
          text: { type: 'string', minLength: 1, maxLength: 2_000 },
        }, ['startSeconds', 'endSeconds', 'text']),
      },
      endSeconds: boundedNum(0, 86_400),
      bedVolume: boundedNum(0, 1),
    }, ['path', 'outputDir', 'language', 'cues']),
  },
  {
    name: 'voice_clone',
    description: `${WRITE} Clona una voz desde un audio de referencia y sintetiza texto (motor XTTS o GPT-SoVITS en engineUrl). Devuelve el WAV resultante.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 20_000 },
      referencePath: { type: 'string', minLength: 1, maxLength: 32_768 },
      engineUrl: { type: 'string', minLength: 1, maxLength: 512 },
      engine: { type: 'string', enum: ['xtts', 'gpt-sovits'] },
      language: { type: 'string', minLength: 2, maxLength: 12 },
      promptText: { type: 'string', maxLength: 20_000 },
    }, ['text', 'referencePath', 'engineUrl', 'language']),
  },
  {
    name: 'lip_sync',
    description: `${WRITE} Sincroniza labios de un video con un audio nuevo (motor en engineUrl). Devuelve el video resultante.`,
    inputSchema: obj({
      videoPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      audioPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      engineUrl: { type: 'string', minLength: 1, maxLength: 512 },
      engine: { type: 'string', maxLength: 64 },
    }, ['videoPath', 'audioPath', 'outputDir', 'engineUrl']),
  },
  {
    name: 'transcribe_asset',
    description: `${WRITE} Transcribe un asset de audio/video del proyecto con whisper.cpp local (devuelve segmentos con tiempos).`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      language: { type: 'string', maxLength: 12 },
      model: { type: 'string', maxLength: 120 },
    }, ['assetId']),
  },
  {
    name: 'background_remove_file',
    description: `${WRITE} Quita el fondo de una imagen/video suelta (devuelve máscara y resultado).`,
    inputSchema: obj({ inputPath: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['inputPath']),
  },
  {
    name: 'background_remove_asset',
    description: `${WRITE} Quita el fondo de un asset del proyecto en un rango de frames y lo devuelve importado como asset nuevo.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      kind: { type: 'string', enum: ['image', 'video'] },
      inFrame: boundedInt(0, 10_000_000),
      outFrame: boundedInt(1, 10_000_000),
    }, ['path', 'kind', 'inFrame', 'outFrame']),
  },
  {
    name: 'upscale_image',
    description: `${WRITE} Upscale de una imagen suelta (devuelve resultado y ruta).`,
    inputSchema: obj({ inputPath: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['inputPath']),
  },
  {
    name: 'upscale_video',
    description: `${WRITE} Upscale de un video suelto (opcionalmente limitado en segundos). Devuelve resultado y ruta.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', maxLength: 32_768 },
      maxSeconds: boundedNum(0.1, 86_400),
    }, ['inputPath']),
  },
  {
    name: 'denoise_media',
    description: `${WRITE} Reducción de ruido de imagen/video con presets fast|balanced|quality y controles de fuerza/temporal/detalle.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', maxLength: 32_768 },
      mode: { type: 'string', enum: ['video', 'image'] },
      preset: { type: 'string', enum: ['fast', 'balanced', 'quality'] },
      strength: boundedNum(0, 100),
      temporal: bool(),
      preserveDetail: bool(),
    }, ['inputPath', 'mode', 'preset']),
  },
  {
    name: 'sharpen_media',
    description: `${WRITE} Cadena de definición (limpieza, escalado, enfoque, curva, grano) sobre imagen/video.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', maxLength: 32_768 },
      mode: { type: 'string', enum: ['video', 'image'] },
      denoise: boundedNum(0, 100),
      deblock: bool(),
      targetHeight: boundedInt(16, 4320),
      highPrecision: bool(),
      unsharpAmount: boundedNum(0, 3),
      unsharpSize: { type: 'integer', enum: [3, 5, 7, 9] },
      curve: boundedNum(0, 100),
      grain: boundedNum(0, 3),
      preset: { type: 'string', maxLength: 64 },
    }, ['inputPath', 'mode']),
  },
  {
    name: 'freeze_frame_extract',
    description: `${WRITE} Extrae un frame congelado de un video como asset nuevo del proyecto.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      seconds: boundedNum(0, 86_400),
    }, ['path', 'seconds']),
  },
  {
    name: 'video_merge',
    description: `${WRITE} Une varios assets de video en un solo archivo en outputDir.`,
    inputSchema: obj({
      assetIds: {
        type: 'array',
        minItems: 2,
        maxItems: 20,
        items: { type: 'string', minLength: 1, maxLength: 256 },
      },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['assetIds', 'outputDir']),
  },
  {
    name: 'video_trim',
    description: `${WRITE} Recorta un asset de video entre segundos y exporta a outputDir.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      startSeconds: boundedNum(0, 86_400),
      endSeconds: boundedNum(0, 86_400),
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['assetId', 'startSeconds', 'endSeconds', 'outputDir']),
  },
  {
    name: 'video_watermark',
    description: `${WRITE} Agrega una marca de agua de texto a un asset de video en outputDir.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      text: { type: 'string', minLength: 1, maxLength: 200 },
      position: { type: 'string', minLength: 1, maxLength: 32 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['assetId', 'text', 'position', 'outputDir']),
  },
  {
    name: 'video_metadata',
    description: `${WRITE} Escribe título/artista/comentario en un asset de video exportado a outputDir.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      title: { type: 'string', maxLength: 200 },
      artist: { type: 'string', maxLength: 200 },
      comment: { type: 'string', maxLength: 500 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['assetId', 'outputDir']),
  },
  {
    name: 'import_timeline',
    description: `${WRITE} Importa una timeline EDL/OTIO/FCPXML/FCP7XML/AAF/OMF al proyecto (assets, pistas, clips, warnings). Requiere confirmRights=true.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      confirmRights: bool(),
    }, ['path', 'confirmRights']),
  },
  {
    name: 'verify_export',
    description: `${READ} Verifica un archivo exportado: contenedor, codecs, resolución, fps, color y bitrate. Para contenido (escenas, silencios, negros, congelados, loudness) usar qc_media.`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'qc_media',
    description: `${READ} Control de calidad de contenido de un archivo suelto (típicamente un MP4 recién exportado): escenas, silencios, negros, frames congelados y loudness medidos con FFmpeg. No exige proyecto abierto.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      sceneThreshold: boundedNum(0, 1),
      silenceDb: boundedNum(-80, 0),
      minSilence: boundedNum(0.05, 10),
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'thumbnail_pick',
    description: `${READ} Propone los mejores frames de un video para thumbnail (análisis de nitidez/composición).`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'thumbnail_save',
    description: `${WRITE} Guarda un data URL de imagen (típicamente de media_thumbnail o render_frame) como archivo PNG/JPG en outputDir. Devuelve ruta, bytes y dimensiones reales del archivo escrito.`,
    inputSchema: obj({
      dataUrl: { type: 'string', minLength: 1, maxLength: 16_777_216, description: 'Data URL de la imagen a guardar.' },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      fileName: { type: 'string', maxLength: 255, description: 'Nombre de archivo opcional.' },
    }, ['dataUrl', 'outputDir']),
  },
  {
    name: 'concat_worker',
    description: `${WRITE} Worker de concatenación (binario concat-media en JSON-lines). action=status informa si el ejecutable existe, qué ops implementa y si hay proceso vivo; action=request ejecuta una op de la allowlist del backend (ping, probe, decode_frame, render_export, shutdown) con params y timeoutMs opcional; action=cancel aborta el render_export en curso sin matar el worker.`,
    inputSchema: obj({
      action: { type: 'string', enum: ['status', 'request', 'cancel'] },
      op: { type: 'string', maxLength: 64, description: 'Op para action=request (ping, probe, decode_frame, render_export, shutdown).' },
      params: { type: 'object', description: 'Params JSON de la op (p. ej. ConcatWorkerExportParams para render_export).' },
      timeoutMs: boundedInt(100, 600_000),
    }, ['action']),
  },
  {
    name: 'render_diary',
    description: `${READ} Historial de renders recientes del proyecto (fecha, perfil, resultado, ruta).`,
    inputSchema: obj({ limit: boundedInt(1, 100) }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'project_versions_list',
    description: `${READ} Snapshots de versiones del proyecto en .olyvia-history (id, fecha, motivo, assets/clips).`,
    inputSchema: obj({ projectPath: { type: 'string', maxLength: 32_768 } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'project_version_restore',
    description: `${WRITE} Restaura una versión del proyecto (modo in-place con backup previo, o copy como archivo nuevo).`,
    inputSchema: obj({
      projectPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      versionId: { type: 'string', minLength: 1, maxLength: 256 },
      mode: { type: 'string', enum: ['in-place', 'copy'] },
    }, ['projectPath', 'versionId']),
  },
  {
    name: 'visual_audit',
    description: `${READ} Audita los visuales del proyecto (catálogo de assets y sus análisis).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'media_probe_file',
    description: `${READ} Sondeo completo de un archivo suelto: duración, contenedor, codecs, resolución, timecode.`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'audio_peaks_path',
    description: `${READ} Forma de onda (picos normalizados) de un archivo de audio suelto, para análisis sin decodificar completo.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      buckets: boundedInt(16, 8192),
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'proxy_status',
    description: `${READ} Estado del proxy de un asset: missing|queued|generating|ready, calidad, progreso, si está actualizado.`,
    inputSchema: obj({ assetId: { type: 'string', minLength: 1, maxLength: 256 } }, ['assetId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'catalog_search',
    description: `${READ} Busca en el catálogo de recursos del estudio (b-roll, música, sfx, plantillas) por texto, tipo y tags.`,
    inputSchema: obj({
      kind: { type: 'string', enum: ['video', 'audio', 'image', 'animation', 'graphic'] },
      text: { type: 'string', maxLength: 500 },
      tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
      limit: boundedInt(1, 200),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'catalog_get',
    description: `${READ} Detalle de una entrada del catálogo de recursos por id (licencia, duración, referencia).`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 256 } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'provider_test',
    description: `${READ} Prueba la conexión con el proveedor de IA configurado (estado, latencia, modelo, URL).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'render_queue',
    description: `${READ} Cola de renders del proyecto (entradas pendientes con estado y progreso).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'vmaf_measure',
    description: `${READ} Mide VMAF (0-100) entre un video original y uno comprimido. null si el FFmpeg no tiene libvmaf.`,
    inputSchema: obj({
      original: { type: 'string', minLength: 1, maxLength: 32_768 },
      compressed: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['original', 'compressed']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'proxy_apply',
    description: `${WRITE} Marca un asset de video para usar su proxy en la edición (cambia el asset del proyecto).`,
    inputSchema: obj({ assetId: { type: 'string', minLength: 1, maxLength: 256 } }, ['assetId']),
  },
  {
    name: 'relink_asset',
    description: `${WRITE} Re-enlaza un asset del proyecto a una nueva ruta de archivo (valida por nombre+tamaño o hash; copia dentro del proyecto si hace falta).`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      newPath: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['assetId', 'newPath']),
  },
  {
    name: 'proxy_ensure',
    description: `${WRITE} Genera (o encola) el proxy de un asset de video en la calidad pedida (540p|720p). Devuelve el estado del proxy.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      quality: { type: 'string', enum: ['540p', '720p'] },
    }, ['assetId']),
  },
  {
    name: 'proxy_cleanup',
    description: `${WRITE} Borra proxies generados (todos, o los de un asset). Devuelve cantidad eliminada y bytes liberados.`,
    inputSchema: obj({ assetId: { type: 'string', maxLength: 256 } }),
  },
  {
    name: 'compress_file',
    description: `${WRITE} Comprime un archivo suelto del disco a mp4/mkv/hevc con modo quality o size (quality 0-100, targetMegabytes, maxWidth, audioKbps).`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      target: { type: 'string', enum: ['mp4', 'mkv', 'hevc'] },
      mode: { type: 'string', enum: ['quality', 'size'] },
      quality: boundedNum(0, 100),
      targetMegabytes: boundedNum(0.1, 100000),
      maxWidth: boundedInt(16, 7680),
      audioKbps: boundedInt(32, 512),
    }, ['inputPath', 'outputDir', 'target', 'mode']),
  },
  {
    name: 'production_remove',
    description: `${WRITE} Elimina una producción del estudio por runId.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 256 } }, ['runId']),
  },
  {
    name: 'downloader_status',
    description: `${READ} Estado del descargador integrado (disponible, versión, ruta, si se puede instalar).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'downloader_bridge_info',
    description: `${READ} Info del puente del descargador (yt-dlp y herramientas asociadas).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'download_probe',
    description: `${READ} Sondea una URL de video/imagen/audio: título, duración, tipo, calidades disponibles, tamaño estimado.`,
    inputSchema: obj({
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      cookiesFile: { type: 'string', maxLength: 32_768 },
      cookiesFromBrowser: { type: 'string', maxLength: 64 },
    }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'playlist_entries',
    description: `${READ} Lista las entradas de una playlist/canal de video (índice, título, duración).`,
    inputSchema: obj({
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      limit: boundedInt(1, 500),
    }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'audio_tracks_url',
    description: `${READ} Lista las pistas de audio de una URL (idioma, codec, calidad).`,
    inputSchema: obj({ url: { type: 'string', minLength: 1, maxLength: 4096 } }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sponsorblock_preview',
    description: `${READ} Previsualiza segmentos SponsorBlock de un video (categoría, inicio, fin, acción).`,
    inputSchema: obj({
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      categories: { type: 'string', maxLength: 500 },
    }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'source_checksum',
    description: `${READ} Checksums (md5/sha256) de la fuente de una URL, para verificar integridad de descargas.`,
    inputSchema: obj({ url: { type: 'string', minLength: 1, maxLength: 4096 } }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'rss_fetch',
    description: `${READ} Lee un feed RSS/Atom (título, link, fecha de cada ítem).`,
    inputSchema: obj({
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      limit: boundedInt(1, 200),
    }, ['url']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'watch_folder_scan',
    description: `${READ} Escanea una carpeta vigilada y devuelve archivos con URLs embebidas (para auto-descarga).`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'proxy_test',
    description: `${READ} Prueba un proxy HTTP (ok, latencia, error).`,
    inputSchema: obj({ proxy: { type: 'string', minLength: 1, maxLength: 512 } }, ['proxy']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'vpn_list',
    description: `${READ} Lista las conexiones VPN configuradas.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'watchdog_status',
    description: `${READ} Estado del watchdog de descargas (instalado, tareas programadas).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'platform_rules',
    description: `${READ} Reglas de exportación por plataforma (YouTube, Shorts, Reels, TikTok).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'youtube_channel_analyze',
    description: `${READ} Analiza un canal de YouTube: videos, títulos, thumbnails, comentarios (puede tardar).`,
    inputSchema: obj({
      channelUrl: { type: 'string', minLength: 1, maxLength: 4096 },
      maxVideos: boundedInt(1, 500),
      detailCount: boundedInt(0, 100),
      includeComments: bool(),
      commentVideos: boundedInt(0, 50),
    }, ['channelUrl']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'creator_hook',
    description: `${WRITE} Genera un video con hook de texto animado (zoom + ganancia de sonido) a partir de un input.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      hookText: { type: 'string', minLength: 1, maxLength: 500 },
      zoomPercent: boundedNum(0, 400),
      soundGainDb: boundedNum(-60, 24),
    }, ['inputPath', 'outputPath', 'hookText']),
  },
  {
    name: 'creator_export_multi_aspect',
    description: `${WRITE} Exporta un video en varios aspectos (vertical, horizontal, square) a outputDir.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      aspects: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['vertical', 'horizontal', 'square'] } },
    }, ['inputPath', 'outputDir']),
  },
  {
    name: 'creator_inject_cta',
    description: `${WRITE} Inyecta un CTA con texto/url (y QR opcional) al final de un video.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      ctaText: { type: 'string', minLength: 1, maxLength: 500 },
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      ctaSeconds: boundedNum(0.5, 30),
      addQr: bool(),
    }, ['inputPath', 'outputPath', 'ctaText', 'url']),
  },
  {
    name: 'creator_interleave_broll',
    description: `${WRITE} Intercala clips de B-roll de un directorio sobre un video cada N segundos.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      brollDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      intervalSeconds: boundedNum(1, 600),
      clipSeconds: boundedNum(0.5, 30),
      maxInsertions: boundedInt(1, 500),
    }, ['inputPath', 'brollDir', 'outputPath']),
  },
  {
    name: 'creator_split_chapters',
    description: `${WRITE} Divide un video largo en capítulos y los exporta a outputDir.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
    }, ['inputPath', 'outputDir']),
  },
  {
    name: 'creator_burn_subtitles',
    description: `${WRITE} Quema subtítulos de texto sobre un video y exporta el resultado.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      subtitleText: { type: 'string', minLength: 1, maxLength: 200_000 },
    }, ['inputPath', 'outputPath', 'subtitleText']),
  },
  {
    name: 'download_pause',
    description: `${WRITE} Pausa una descarga en curso (o la activa por defecto).`,
    inputSchema: obj({ runId: { type: 'string', maxLength: 128 } }),
  },
  {
    name: 'download_resume',
    description: `${WRITE} Reanuda una descarga pausada.`,
    inputSchema: obj({ runId: { type: 'string', maxLength: 128 } }),
  },
  {
    name: 'download_cancel',
    description: `${WRITE} Cancela una descarga en curso.`,
    inputSchema: obj({ runId: { type: 'string', maxLength: 128 } }),
  },
  {
    name: 'download_media',
    description: `${WRITE} Descarga un video/imagen/audio/playlist de una URL. Pipeline completo: calidad, codec, HDR, tamaño objetivo, cinemático, voz TTS, watermark, delogo, upscale, autoRoute.`,
    inputSchema: obj({
      url: { type: 'string', minLength: 1, maxLength: 4096 },
      runId: { type: 'string', maxLength: 128 },
      maxHeight: boundedInt(144, 4320),
      compression: { type: 'string', enum: ['none', 'high', 'balanced', 'compact'] },
      codec: { type: 'string', enum: ['h265', 'h264', 'av1'] },
      quality: { type: 'string', enum: ['best', 'worst', 'height'] },
      kind: { type: 'string', enum: ['video', 'image', 'audio', 'gallery'] },
      hdrMode: { type: 'string', enum: ['tonemap', 'preserve'] },
      targetSizeMb: boundedNum(0.1, 100000),
      keepOriginal: bool(),
      playlist: bool(),
      cookiesFile: { type: 'string', maxLength: 32_768 },
      cookiesFromBrowser: { type: 'string', maxLength: 64 },
      format: { type: 'string', enum: ['mp4', 'mkv', 'webm', 'mp3', 'm4a'] },
      saveToDownloads: bool(),
      destinationRoot: { type: 'string', maxLength: 32_768 },
      cinematic: bool(),
      cinematicFocus: { type: 'string', enum: ['center', 'left', 'right', 'top', 'bottom'] },
      replacementAudio: { type: 'string', maxLength: 32_768 },
      autoPipeline: bool(),
      audioSpeedNoise: bool(),
      voicePipeline: bool(),
      voiceScript: { type: 'string', maxLength: 50_000 },
      watermark: bool(),
      delogo: bool(),
      delogoCorner: { type: 'string', enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left'] },
      upscale: bool(),
      upscaleTarget: { type: 'string', enum: ['auto', '1080', '2160'] },
      autoRoute: bool(),
      sourceTitle: { type: 'string', maxLength: 500 },
      sourceDuration: boundedNum(0, 86400),
      proxy: { type: 'string', maxLength: 512 },
    }, ['url', 'kind']),
  },
  {
    name: 'cleanup_download',
    description: `${WRITE} Limpia los archivos temporales de una descarga por runId.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'install_downloader',
    description: `${WRITE} Instala el descargador integrado (yt-dlp) en el equipo.`,
    inputSchema: obj({}),
  },
  {
    name: 'update_downloader',
    description: `${WRITE} Actualiza el descargador integrado a la última versión.`,
    inputSchema: obj({}),
  },
  {
    name: 'vpn_connect',
    description: `${WRITE} Conecta una VPN configurada por nombre. Devuelve el estado.`,
    inputSchema: obj({ name: { type: 'string', minLength: 1, maxLength: 200 } }, ['name']),
  },
  {
    name: 'vpn_disconnect',
    description: `${WRITE} Desconecta una VPN por nombre. Devuelve el estado.`,
    inputSchema: obj({ name: { type: 'string', minLength: 1, maxLength: 200 } }, ['name']),
  },
  {
    name: 'watchdog_install',
    description: `${WRITE} Instala el watchdog de descargas (tareas programadas del SO).`,
    inputSchema: obj({}),
  },
  {
    name: 'watchdog_remove',
    description: `${WRITE} Quita el watchdog de descargas.`,
    inputSchema: obj({}),
  },
  {
    name: 'production_plan_from_brief',
    description: `${READ} Construye un ProductionPlan válido desde un brief estructurado (objetivo, audiencia, tono, key points, plataforma, aspecto, voz, música, título, B-roll, costo máx). Sin provider ni costo.`,
    inputSchema: obj({
      objective: { type: 'string', minLength: 1, maxLength: 2000 },
      audience: { type: 'string', maxLength: 500 },
      tone: { type: 'string', maxLength: 500 },
      keyPoints: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 2000 } },
      sceneCount: boundedInt(1, 8),
      durationSeconds: boundedInt(3, 3600),
      platform: { type: 'string', enum: ['youtube', 'shorts', 'reels', 'tiktok'] },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5'] },
      voice: { type: 'string', maxLength: 200 },
      music: bool(),
      titleCard: bool(),
      brollQuery: { type: 'string', maxLength: 500 },
      maxCostCents: boundedNum(0, 100000000),
    }, ['objective']),
  },
  {
    name: 'production_plan_from_text',
    description: `${WRITE} Interpreta texto libre con el provider de IA configurado y devuelve un ProductionPlan (no crea ni ejecuta la corrida). approvedCost=true autoriza gasto del provider remoto.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 10, maxLength: 2000 },
      approvedCost: bool(),
    }, ['text']),
  },
  {
    name: 'production_create',
    description: `${WRITE} Crea una corrida de producción desde un ProductionPlan (objeto plan, típico de production_plan_from_*). runId opcional, maxCostCents tope de gasto.`,
    inputSchema: obj({
      plan: { type: 'object' },
      runId: { type: 'string', maxLength: 128 },
      maxCostCents: boundedNum(0, 100000000),
    }, ['plan']),
  },
  {
    name: 'production_status',
    description: `${READ} Estado de una corrida de producción por runId (etapas, costos, errores, output).`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'production_list',
    description: `${READ} Lista las corridas de producción del estudio.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'production_start',
    description: `${WRITE} Arranca el driver que conduce una corrida hasta estado terminal/pausado/fallido. Idempotente; reanuda si estaba pausada.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'production_advance',
    description: `${WRITE} Avanza UNA etapa del pipeline de la corrida (requiere proyecto abierto; etapas async quedan running y hay que volver a llamar).`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'production_pause',
    description: `${WRITE} Pausa una corrida entre etapas.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'production_resume',
    description: `${WRITE} Reanuda una corrida pausada o fallida.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'production_cancel',
    description: `${WRITE} Cancela una corrida de producción.`,
    inputSchema: obj({ runId: { type: 'string', minLength: 1, maxLength: 128 } }, ['runId']),
  },
  {
    name: 'subtitles_save_localized',
    description: `${WRITE} Guarda subtítulos en otro idioma/formato (srt|vtt) en outputDir.`,
    inputSchema: obj({
      content: { type: 'string', minLength: 1, maxLength: 500_000 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      baseName: { type: 'string', minLength: 1, maxLength: 200 },
      language: { type: 'string', minLength: 2, maxLength: 12 },
      format: { type: 'string', enum: ['srt', 'vtt'] },
    }, ['content', 'outputDir', 'baseName', 'language', 'format']),
  },
  {
    name: 'export_short',
    description: `${WRITE} Exporta un rango de un asset como MP4 vertical 1080x1920 con smart reframe opcional (detecta caras).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      startSeconds: boundedNum(0, 86_400),
      endSeconds: boundedNum(0, 86_400),
      label: { type: 'string', maxLength: 200 },
      smartReframe: bool(),
    }, ['path', 'outputDir', 'startSeconds', 'endSeconds']),
  },
  {
    name: 'analyze_face_track',
    description: `${READ} Detecta y trackea caras en un video entre segundos (muestras, track, expresiones de encuadre).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      startSeconds: boundedNum(0, 86_400),
      endSeconds: boundedNum(0, 86_400),
    }, ['path', 'startSeconds', 'endSeconds']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'track_object',
    description: `${READ} Trackea un objeto en un video dado un rectángulo semilla normalizado 0-1 (NCC con confianza y rotación).`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768 },
      rect: obj({
        x: boundedNum(0, 1), y: boundedNum(0, 1),
        w: boundedNum(0.001, 1), h: boundedNum(0.001, 1),
      }, ['x', 'y', 'w', 'h']),
      startSeconds: boundedNum(0, 86_400),
      endSeconds: boundedNum(0, 86_400),
    }, ['path', 'rect', 'startSeconds', 'endSeconds']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'analyze_images',
    description: `${READ} Análisis visual de assets imagen del proyecto (escena, color, nitidez, rostros).`,
    inputSchema: obj({
      assetIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 256 } },
    }, ['assetIds']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'analyze_media_frames',
    description: `${READ} Como analyze_images pero acepta videos: mide el cuadro del punto medio de cada uno (la IA puede ver los clips).`,
    inputSchema: obj({
      assetIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 256 } },
    }, ['assetIds']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'convert_media_batch',
    description: `${WRITE} Convierte varios assets del proyecto a otro formato en outputDir (quality, maxWidth, encoder, enhance opcionales). Devuelve resultado por asset.`,
    inputSchema: obj({
      assetIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 256 } },
      target: { type: 'string', maxLength: 32 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      quality: boundedNum(0, 100),
      maxWidth: boundedInt(16, 7680),
      encoder: { type: 'string', maxLength: 64 },
    }, ['assetIds', 'target', 'outputDir']),
  },
  {
    name: 'models_list',
    description: `${READ} Lista los modelos de IA locales disponibles (whisper, etc.) con estado.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'model_download',
    description: `${WRITE} Descarga un modelo de IA local por id.`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']),
  },
  {
    name: 'model_delete',
    description: `${WRITE} Elimina un modelo de IA local por id.`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']),
  },
  {
    name: 'check_asset_files',
    description: `${READ} Verifica rutas absolutas del disco y devuelve info de archivo (tipo, tamaño) — útil para detectar medios faltantes.`,
    inputSchema: obj({
      paths: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 32_768 } },
    }, ['paths']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'plugins_list',
    description: `${READ} Lista los plugins instalados (oficiales y de usuario) con estado.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'plugin_install',
    description: `${WRITE} Instala un plugin desde una ruta de paquete.`,
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 32_768 } }, ['path']),
  },
  {
    name: 'plugin_remove',
    description: `${WRITE} Desinstala un plugin por id.`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']),
  },
  {
    name: 'plugin_set_enabled',
    description: `${WRITE} Activa o desactiva un plugin por id.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 200 },
      enabled: bool(),
    }, ['id', 'enabled']),
  },
  {
    name: 'extension_status',
    description: `${READ} Estado de la extensión del navegador (instalada, preparable).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'system_info',
    description: `${READ} Info del sistema: GPU, FFmpeg/FFprobe detectados, recursos.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'notify_user',
    description: `${WRITE} Muestra una notificación de la app al usuario (título + cuerpo).`,
    inputSchema: obj({
      title: { type: 'string', minLength: 1, maxLength: 200 },
      body: { type: 'string', maxLength: 1000 },
    }, ['title']),
  },
  {
    name: 'mcp_servers_list',
    description: `${READ} Lista los servidores MCP externos configurados.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_server_probe',
    description: `${READ} Prueba la conexión con un servidor MCP externo por id.`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_server_delete',
    description: `${WRITE} Elimina un servidor MCP externo configurado por id.`,
    inputSchema: obj({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']),
  },
  {
    name: 'mcp_session_status',
    description: `${READ} Sesiones MCP vivas ahora mismo.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_audit_tail',
    description: `${READ} Últimas entradas del audit log del servidor MCP (santizadas, default 50, tope 500).`,
    inputSchema: obj({ limit: boundedInt(1, 500) }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_external_call',
    description: `${WRITE} Ejecuta una tool en un servidor MCP externo configurado. argsJson = JSON de argumentos.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 200 },
      tool: { type: 'string', minLength: 1, maxLength: 200 },
      argsJson: { type: 'string', maxLength: 100_000 },
    }, ['id', 'tool']),
  },
  {
    name: 'flow_proxies_get',
    description: `${READ} Proxies por cuenta de Google Flow configurados.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'flow_proxy_set',
    description: `${WRITE} Configura (o limpia con null) el proxy de una cuenta de Google Flow.`,
    inputSchema: obj({
      accountId: { type: 'string', minLength: 1, maxLength: 200 },
      proxy: { type: 'string', maxLength: 512 },
    }, ['accountId']),
  },
  {
    name: 'audio_peaks',
    description: `${READ} Forma de onda (picos normalizados) de un asset de audio del proyecto.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      buckets: boundedInt(16, 8192),
    }, ['assetId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'visual_catalog',
    description: `${READ} Catálogo visual del proyecto (plantillas, estilos, recursos con metadatos).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'quality_gate_review',
    description: `${READ} Auditoría de calidad del proyecto (reporte consolidado del quality gate).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'convert_file',
    description: `${WRITE} Convierte un archivo suelto a GIF o audio (mp3/wav/m4a/aac/ogg/opus/flac) — para entregables del render.`,
    inputSchema: obj({
      inputPath: { type: 'string', minLength: 1, maxLength: 32_768 },
      target: { type: 'string', enum: ['gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'] },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      quality: boundedNum(0, 100),
      maxWidth: boundedInt(16, 7680),
      fps: boundedNum(1, 120),
    }, ['inputPath', 'target', 'outputDir']),
  },
  {
    name: 'compress_asset',
    description: `${WRITE} Comprime un asset del proyecto a mp4/mkv/hevc con modo quality o size (quality 0-100, targetMegabytes, maxWidth, audioKbps).`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      outputDir: { type: 'string', minLength: 1, maxLength: 32_768 },
      target: { type: 'string', enum: ['mp4', 'mkv', 'hevc'] },
      mode: { type: 'string', enum: ['quality', 'size'] },
      quality: boundedNum(0, 100),
      targetMegabytes: boundedNum(0.1, 100000),
      maxWidth: boundedInt(16, 7680),
      audioKbps: boundedInt(32, 512),
    }, ['assetId', 'outputDir', 'target', 'mode']),
  },
  {
    name: 'proxy_cancel',
    description: `${WRITE} Cancela la generación del proxy de un asset. Devuelve el estado resultante.`,
    inputSchema: obj({ assetId: { type: 'string', minLength: 1, maxLength: 256 } }, ['assetId']),
  },
  {
    name: 'mcp_server_status',
    description: `${READ} Estado del servidor MCP embebido (url, si está corriendo).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_detect_clients',
    description: `${READ} Clientes de IA detectados en el equipo (Claude Desktop, etc.) y si están instalados.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mcp_autoconnect',
    description: `${WRITE} Arranca el servidor MCP si hace falta y conecta un cliente de IA externo con un clic (escribe su config).`,
    inputSchema: obj({ client: { type: 'string', minLength: 1, maxLength: 200 } }, ['client']),
  },
  {
    name: 'studio_capabilities',
    description: `${READ} Inventario de capacidades del estudio autónomo: providers de generación, fuentes de adquisición, etapas del pipeline y disponibilidad de ffmpeg/ffprobe.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tts_voices',
    description: `${READ} Voces TTS built-in disponibles sin descarga (sintetizador formant local, salida 24 kHz mono WAV).`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tts_synthesize',
    description: `${WRITE} Sintetiza narración TTS a WAV. Acepta marcadores de pausa [pause 1s]/[pause 500ms]. pace 0.5-2.0, semitones ±12.`,
    inputSchema: obj({
      text: str('Texto a narrar (máx 64 KB).'),
      output: str('Ruta .wav de salida.'),
      voiceId: str('ID de voz (ver tts_voices). Default: primera del catálogo.'),
      pace: boundedNum(0.5, 2, 'Velocidad 0.5-2.0 (default 1).'),
      semitones: boundedNum(-12, 12, 'Tono ±12 semitonos (default 0).'),
    }),
  },
  {
    name: 'text_fonts_list',
    description: `${READ} Familias de fuentes del motor de texto (bundled OFL: Inter, JetBrains Mono, Noto Serif + fuentes del sistema) con sus estilos.`,
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'text_render_preview',
    description: `${WRITE} Renderiza texto a PNG con el motor OpenType (shaping, bidi, corte de líneas). Devuelve path + geometría; verificable con analyze_images. Soporta canvas, color #RRGGBB, wrap, interlineado.`,
    inputSchema: obj({
      text: str('Texto a renderizar (máx 64 KB).'),
      output: str('Ruta .png de salida.'),
      fontSize: num('Tamaño en px (8-512, default 64).'),
      family: str('Familia (ver text_fonts_list; default Inter).'),
      style: str('Estilo: Regular, Bold, Italic… (default Regular).'),
      align: str('Alineación: left|center|right (default left).'),
      wrapWidth: num('Ancho de wrap en px.'),
      leading: num('Interlineado extra en px.'),
      canvasWidth: num('Ancho del canvas px (con canvasHeight).'),
      canvasHeight: num('Alto del canvas px (con canvasWidth).'),
      color: str('Color #RRGGBB (default blanco).'),
    }),
  },
  {
    name: 'subtitles_inspect_file',
    description: READ + ' Inspecciona un archivo de subtítulos: detecta el formato real (srt/vtt/scc/mcc/stl/ttml/dfxp) por contenido y extensión, cuenta cues, duración total y devuelve las primeras 20 líneas con timestamps.',
    inputSchema: obj({
      path: str('Ruta del archivo de subtítulos.'),
    }, ['path']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'subtitles_convert_file',
    description: WRITE + ' Convierte subtítulos entre srt/vtt/scc/mcc/stl/ttml/dfxp. El formato de salida se infiere de la extensión del archivo destino (.srt, .vtt, .scc, .mcc, .stl, .ttml, .dfxp).',
    inputSchema: obj({
      input: str('Archivo de subtítulos de entrada.'),
      output: str('Archivo de salida con extensión del formato destino.'),
    }, ['input','output']),
  },
  {
    name: 'memory_add',
    description: `${WRITE} Guarda una nota en la memoria persistente de la IA (preferencias del usuario, decisiones de estilo, datos del proyecto que deben sobrevivir sesiones). La memoria se inyecta como contexto en cada pedido futuro. Usala cuando el usuario pida recordar algo o cuando una decisión de edición deba persistir.`,
    inputSchema: obj({
      text: { type: 'string', minLength: 1, maxLength: 2000, description: 'La nota a recordar, en una o dos frases.' },
    }, ['text']),
  },
  {
    name: 'memory_list',
    description: `${READ} Lista las notas guardadas en la memoria persistente de la IA (id, texto, fecha).`,
    inputSchema: obj({}),
  },
  {
    name: 'memory_forget',
    description: `${WRITE} Borra una nota de la memoria persistente de la IA por id (obtenido de memory_list).`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['id']),
  },
  {
    name: 'media_probe_color',
    description: `${READ} Metadatos de color de un video: espacio, transfer y primarias reales (ffprobe), clasificación hdr (pq/hlg/sdr), wide gamut y la lista de cameraProfile log→Rec.709 que el proyecto soporta, con sugerencia conservadora (hdr-pq, hdr-hlg o posible-log). Usala antes de aplicar un LUT o grading a material de cámara.`,
    inputSchema: obj({
      path: { type: 'string', minLength: 1, maxLength: 32_768, description: 'Ruta absoluta del archivo de video.' },
    }, ['path']),
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
        intensity: boundedNum(0, 1),
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
  // ── Pasada 155: generación AI, ciclo de render, proveedores ──
  {
    name: 'script_generate',
    description: `${WRITE} Genera un plan de guion con el proveedor de IA configurado. approvedCost debe ser true para autorizar el costo del proveedor.`,
    inputSchema: obj(
      { brief: { type: 'string', minLength: 1, maxLength: 8000 }, sceneCount: boundedInt(1, 60), language: { type: 'string', minLength: 2, maxLength: 16 }, approvedCost: bool('true para autorizar el costo del proveedor') },
      ['brief', 'sceneCount', 'language', 'approvedCost'],
    ),
  },
  {
    name: 'effect_recipe_generate',
    description: `${WRITE} Genera una receta de efectos con el proveedor de IA configurado a partir de un prompt (p. ej. look cinematográfico frío).`,
    inputSchema: obj(
      { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, approvedCost: bool() },
      ['prompt'],
    ),
  },
  {
    name: 'motion_suggest',
    description: `${WRITE} Pide al proveedor de IA configurado props para una motion template (brief + templateId de motion_templates_list).`,
    inputSchema: obj(
      { brief: { type: 'string', minLength: 1, maxLength: 4000 }, templateId: { type: 'string', minLength: 1, maxLength: 120 }, approvedCost: bool() },
      ['brief', 'templateId', 'approvedCost'],
    ),
  },
  {
    name: 'whiteboard_status',
    description: `${READ} Estado del generador whiteboard-animator (disponibilidad y requisitos).`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'whiteboard_generate',
    description: `${WRITE} Genera un MP4 mano-que-dibuja desde una imagen (audioPath opcional sincroniza con narración). El video queda en el cache de la app.`,
    inputSchema: obj(
      { imagePath: { type: 'string', minLength: 1, maxLength: 32768 }, audioPath: { type: 'string', maxLength: 32768 }, durationSeconds: boundedNum(1, 600), quality: { type: 'string', enum: ['low', 'medium', 'high'] } },
      ['imagePath'],
    ),
  },
  {
    name: 'system_fonts_list',
    description: `${READ} Familias tipográficas instaladas en el sistema (text_render_preview usa las bundled OFL).`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'hardware_encoders',
    description: `${READ} Encoders de hardware detectados (nvenc/qsv/amf/mf) con su estado.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'download_disk_space',
    description: `${READ} Bytes libres en disco para descargas (path opcional; default el de descargas).`,
    inputSchema: obj(
      { path: { type: 'string', maxLength: 1024 } },
      [],
    ),
  },
  {
    name: 'render_active',
    description: `${READ} Job de render activo ahora mismo (jobId) o null.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'render_cancel',
    description: `${WRITE} Cancela un render en curso por jobId.`,
    inputSchema: obj(
      { jobId: { type: 'string', minLength: 1, maxLength: 128 } },
      ['jobId'],
    ),
  },
  {
    name: 'render_start',
    description: `${WRITE} Inicia un render del proyecto abierto a una ruta de salida explícita: perfil, captions, encoder HW y rango de frames opcionales.`,
    inputSchema: obj(
      { profileId: { type: 'string', minLength: 1, maxLength: 120 }, outputPath: { type: 'string', minLength: 1, maxLength: 1024 }, includeCaptions: bool(), hardwareEncoder: { type: 'string', maxLength: 32 }, startFrame: boundedInt(0, 100000000), endFrame: boundedInt(1, 100000000), motionPlans: { type: 'object' } },
      ['profileId', 'outputPath', 'includeCaptions'],
    ),
  },
  {
    name: 'render_variant',
    description: `${WRITE} Renderiza un archivo de proyecto (.editoria.json) con un perfil a una salida explícita, sin abrirlo en la sesión.`,
    inputSchema: obj(
      { projectPath: { type: 'string', minLength: 1, maxLength: 1024 }, profileId: { type: 'string', minLength: 1, maxLength: 120 }, outputPath: { type: 'string', minLength: 1, maxLength: 1024 }, includeCaptions: bool(), motionPlans: { type: 'object' } },
      ['projectPath', 'profileId', 'outputPath', 'includeCaptions'],
    ),
  },
  {
    name: 'render_cache_prune',
    description: `${WRITE} Limpia la caché de render del backend.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'render_queue_clear_finished',
    description: `${WRITE} Vacía la cola de renders persistida en el backend y devuelve lo que queda.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'project_variant_write',
    description: `${WRITE} Escribe una variante del proyecto (objeto ProjectDocument) en un directorio con nombre de archivo, sin tocar la sesión.`,
    inputSchema: obj(
      { directory: { type: 'string', minLength: 1, maxLength: 1024 }, fileName: { type: 'string', minLength: 1, maxLength: 200 }, project: { type: 'object' } },
      ['directory', 'fileName', 'project'],
    ),
  },
  {
    name: 'media_plan_match',
    description: `${WRITE} Empareja oraciones del guion con imágenes por relevancia medida (visión del proveedor configurado). approvedCost autoriza el costo.`,
    inputSchema: obj(
      { sentences: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', maxLength: 2000 } }, images: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', maxLength: 1024 } }, imageDescriptions: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 2000 } }, approvedCost: bool() },
      ['sentences', 'images'],
    ),
  },
  {
    name: 'audio_provider_get',
    description: `${READ} Proveedor de audio configurado (TTS/narración): kind, voz, modelo, URL — sin la API key.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'audio_provider_save',
    description: `${WRITE} Configura el proveedor de audio (kind, voiceId, modelId, externalUrl, approved; apiKey opcional se guarda en el credential manager).`,
    inputSchema: obj(
      { kind: { type: 'string', minLength: 1, maxLength: 64 }, voiceId: { type: 'string', maxLength: 200 }, modelId: { type: 'string', maxLength: 200 }, externalUrl: { type: 'string', maxLength: 2048 }, approved: bool(), apiKey: { type: 'string', maxLength: 512 } },
      ['kind', 'voiceId', 'modelId', 'externalUrl', 'approved'],
    ),
  },
  {
    name: 'audio_provider_clear_key',
    description: `${WRITE} Borra la API key guardada del proveedor de audio.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'whisper_model_status',
    description: `${READ} Estado del motor nativo whisper.cpp: modelos descargados, cargado, descarga en curso.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'whisper_model_download',
    description: `${WRITE} Descarga un modelo ggml de whisper (tiny, base, small... .en). transcribe_asset lo usa automáticamente.`,
    inputSchema: obj(
      { modelId: { type: 'string', minLength: 1, maxLength: 64 } },
      ['modelId'],
    ),
  },
  {
    name: 'whisper_model_download_cancel',
    description: `${WRITE} Cancela la descarga de modelo whisper en curso.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'mcp_server_save',
    description: `${WRITE} Registra o actualiza un servidor MCP externo (id opcional para update, nombre, comando, args, env, workingDir, enabled).`,
    inputSchema: obj(
      { id: { type: 'string', maxLength: 128 }, name: { type: 'string', minLength: 1, maxLength: 200 }, command: { type: 'string', minLength: 1, maxLength: 1024 }, args: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 2048 } }, env: { type: 'array', maxItems: 100, items: { type: 'object' } }, workingDir: { type: 'string', maxLength: 1024 }, enabled: bool() },
      ['name', 'command', 'enabled'],
    ),
  },
  {
    name: 'mcp_session_close',
    description: `${WRITE} Cierra la sesión viva de un servidor MCP externo por id.`,
    inputSchema: obj(
      { id: { type: 'string', minLength: 1, maxLength: 128 } },
      ['id'],
    ),
  },
  {
    name: 'web_session_nav',
    description: `${WRITE} Navega una sesión web embebida (back/forward/reload; slot opcional).`,
    inputSchema: obj(
      { direction: { type: 'string', enum: ['back', 'forward', 'reload'] }, slot: { type: 'string', maxLength: 64 } },
      ['direction'],
    ),
  },
  {
    name: 'web_session_eval',
    description: `${WRITE} Evalúa JavaScript en una sesión web embebida y devuelve el resultado serializado (slot opcional).`,
    inputSchema: obj(
      { js: { type: 'string', minLength: 1, maxLength: 64000 }, slot: { type: 'string', maxLength: 64 } },
      ['js'],
    ),
  },
  {
    name: 'vpn_wireguard',
    description: `${READ} Estado de WireGuard (instalado y ruta).`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'vpn_wireguard_open',
    description: `${WRITE} Abre la aplicación/configuración de WireGuard.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'extension_prepare',
    description: `${WRITE} Prepara/instala la extensión del navegador para la integración web.`,
    inputSchema: obj(
      {},
      [],
    ),
  },
  {
    name: 'publication_manifest_save',
    description: `${WRITE} Guarda el manifiesto de publicación (objeto JSON) y devuelve la ruta.`,
    inputSchema: obj(
      { manifest: { type: 'object' } },
      ['manifest'],
    ),
  },
  {
    name: 'recent_project_thumbnail',
    description: `${READ} Miniatura en caché de un archivo de proyecto reciente (path absoluto).`,
    inputSchema: obj(
      { path: { type: 'string', minLength: 1, maxLength: 1024 } },
      ['path'],
    ),
  },
  {
    name: 'tool_choose',
    description: `${WRITE} Re-detecta la ruta de ffmpeg o ffprobe del sistema (self-heal de herramientas).`,
    inputSchema: obj(
      { tool: { type: 'string', enum: ['ffmpeg', 'ffprobe'] } },
      ['tool'],
    ),
  },
  {
    name: 'open_external_url',
    description: `${WRITE} Abre una URL en el navegador del sistema.`,
    inputSchema: obj(
      { url: { type: 'string', minLength: 1, maxLength: 4096 } },
      ['url'],
    ),
  },
  {
    name: 'reveal_output',
    description: `${WRITE} Revela un archivo o carpeta en el Explorador de Windows.`,
    inputSchema: obj(
      { path: { type: 'string', minLength: 1, maxLength: 1024 } },
      ['path'],
    ),
  },
  // ── Pasada 156: recuperación, memoria del director y preferencias ──
  {
    name: 'recovery_status',
    description: `${READ} Si hay una instantánea de recuperación (cierre inesperado con cambios sin guardar): path, fecha y nombre de archivo.`,
    inputSchema: obj({}, []),
  },
  {
    name: 'recovery_restore',
    description: `${WRITE} Recupera la sesión interrumpida: abre el proyecto de la instantánea de recuperación. Reemplaza el estado actual.`,
    inputSchema: obj({}, []),
  },
  {
    name: 'recovery_dismiss',
    description: `${WRITE} Descarta la instantánea de recuperación (borra los cambios sin guardar recuperables).`,
    inputSchema: obj({}, []),
  },
  {
    name: 'director_memory_reset',
    description: `${WRITE} Reinicia la memoria de calibración del director automático (perfiles por plataforma vuelven a default).`,
    inputSchema: obj({}, []),
  },
  {
    name: 'preferences_export',
    description: `${READ} Exporta las preferencias locales (apariencia, atajos, comportamiento) como JSON legible + nombre de archivo sugerido.`,
    inputSchema: obj({}, []),
  },
  {
    name: 'preferences_import',
    description: `${WRITE} Aplica un paquete de preferencias exportado (json de preferences_export). Valida campo por campo; un archivo corrupto no se aplica a medias.`,
    inputSchema: obj(
      { json: { type: 'string', minLength: 2, maxLength: 1_000_000 } },
      ['json'],
    ),
  },
  // ── Pasada 157: catálogo de efectos y stack por clip ──
  {
    name: 'effect_catalog_search',
    description: `${READ} Busca en el catálogo completo de efectos (video, transición, audio) por texto, kind o categoría. Devuelve id, nombre, descripción y esquema de parámetros de cada efecto.`,
    inputSchema: obj(
      {
        query: { type: 'string', maxLength: 200 },
        kind: { type: 'string', enum: ['video', 'transition', 'audio'] },
        category: { type: 'string', maxLength: 32 },
        limit: boundedInt(1, 200),
      },
      [],
    ),
  },
  {
    name: 'effect_stack_list',
    description: `${READ} Lista las instancias del stack de efectos de video y de audio de un clip (id de instancia, effectId, enabled, params).`,
    inputSchema: obj(
      { clipId: { type: 'string', minLength: 1, maxLength: 256 } },
      ['clipId'],
    ),
  },
  {
    name: 'effect_stack_add',
    description: `${WRITE} Agrega una instancia del catálogo de efectos a un clip (params opcional; se normalizan contra el manifiesto). kind audio va a audioStack, video a stack. Las transiciones usan transition_add.`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        effectId: { type: 'string', minLength: 1, maxLength: 120 },
        params: { type: 'object' },
        target: { type: 'string', enum: ['video', 'audio'] },
      },
      ['clipId', 'effectId'],
    ),
  },
  {
    name: 'effect_stack_remove',
    description: `${WRITE} Quita una instancia del stack de efectos de un clip por instanceId (busca en stack y audioStack).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
      },
      ['clipId', 'instanceId'],
    ),
  },
  {
    name: 'effect_stack_set_enabled',
    description: `${WRITE} Activa o desactiva una instancia del stack sin quitarla (bypassea el efecto en preview y export).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
        enabled: bool(),
      },
      ['clipId', 'instanceId', 'enabled'],
    ),
  },
  {
    name: 'effect_stack_set_param',
    description: `${WRITE} Cambia un parámetro de una instancia del stack (value: number, string, boolean o par). El valor se coerciona contra el ParamSpec del efecto.`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
        param: { type: 'string', minLength: 1, maxLength: 64 },
        value: {},
      },
      ['clipId', 'instanceId', 'param', 'value'],
    ),
  },
  {
    name: 'effect_stack_reset',
    description: `${WRITE} Vuelve los parámetros de una instancia del stack a los defaults del manifiesto (conserva id y enabled).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
      },
      ['clipId', 'instanceId'],
    ),
  },
  {
    name: 'effect_stack_move',
    description: `${WRITE} Reordena una instancia dentro de su stack (direction: up = se aplica antes, down = después; o toIndex absoluto).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
        direction: { type: 'string', enum: ['up', 'down'] },
        toIndex: boundedInt(0, 31),
      },
      ['clipId', 'instanceId'],
    ),
  },
  {
    name: 'effect_catalog_get',
    description: `${READ} Devuelve el manifiesto completo de un efecto del catálogo por id: categoría, kind, descripción, keywords y esquema de parámetros (tipo, rango, default, opciones).`,
    inputSchema: obj({
      effectId: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['effectId']),
  },
  {
    name: 'effect_stack_duplicate',
    description: `${WRITE} Duplica una instancia del stack de efectos de un clip (nuevo id, mismos params, insertada debajo del original).`,
    inputSchema: obj(
      {
        clipId: { type: 'string', minLength: 1, maxLength: 256 },
        instanceId: { type: 'string', minLength: 1, maxLength: 120 },
      },
      ['clipId', 'instanceId'],
    ),
  },

  // ── Pasada 158: grafos de nodos, edición por texto y Lottie ────────
  {
    name: 'node_graph_list',
    description: `${READ} Lista los grafos de procesamiento guardados en el proyecto (x-nodeGraphs): nombre, fecha de actualización y cantidad de nodos/aristas.`,
    inputSchema: obj({}),
  },
  {
    name: 'node_graph_get',
    description: `${READ} Devuelve un grafo guardado completo: nodos (kind, label, assetId, manifestId, params), posiciones y aristas.`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['name']),
  },
  {
    name: 'node_graph_validate',
    description: `${READ} Valida un grafo de nodos: ciclos, aristas rotas, nodos sin asset/efecto/texto y coherencia render↔input. Acepta name (grafo guardado) o graph (JSON inline).`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
      graph: { type: 'object' },
    }),
  },
  {
    name: 'node_graph_save',
    description: `${WRITE} Guarda un grafo de nodos en el proyecto (upsert por name). El grafo debe pasar validateGraph: ciclos, aristas rotas o nodos incompletos se rechazan con la lista de problemas.`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
      graph: { type: 'object' },
    }, ['name', 'graph']),
  },
  {
    name: 'node_graph_remove',
    description: `${WRITE} Elimina un grafo guardado del proyecto por nombre.`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['name']),
  },
  {
    name: 'node_graph_execute',
    description: `${WRITE} Ejecuta un grafo guardado sobre el proyecto en un solo paso de undo: nodos input→effect/audio-fx→caption→render en orden topológico. Devuelve resultados por nodo y renderRequested (si hay nodo render, encadenar project_save y después render_start — el render usa el documento persistido).`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['name']),
  },
  {
    name: 'text_edit_build',
    description: `${WRITE} Edición por texto estilo Descript: dado un asset de video y sus segmentos de transcripción, monta en una pista nueva los rangos NO excluidos, uno detrás de otro. Exclusiones por índice de segmento (exclude). Obtener segmentos con transcribe_asset primero.`,
    inputSchema: obj({
      assetId: { type: 'string', minLength: 1, maxLength: 256 },
      segments: {
        type: 'array', minItems: 1, maxItems: 5000,
        items: obj({
          start: boundedNum(0, 86400),
          end: boundedNum(0, 86400),
          text: { type: 'string', minLength: 1, maxLength: 2000 },
        }, ['start', 'end', 'text']),
      },
      exclude: { type: 'array', maxItems: 5000, items: boundedInt(0, 4999) },
      atFrame: boundedInt(0, 100000000),
      label: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['assetId', 'segments']),
  },
  {
    name: 'lottie_import',
    description: `${WRITE} Importa una animación Lottie (.json) como asset de video con alfa: la rasteriza en la app (lottie-web), la codifica a WebM VP9 transparente y la agrega al proyecto. Requiere confirmRights=true (derechos de la animación). Fuente: json inline (máx ~2M chars) o path (máx 512KB por fs_read). Devuelve assetId para clip_add.`,
    inputSchema: obj({
      json: { type: 'string', minLength: 2, maxLength: 2000000 },
      path: { type: 'string', minLength: 1, maxLength: 1024 },
      label: { type: 'string', minLength: 1, maxLength: 120 },
      fps: boundedNum(1, 60),
      maxFrames: boundedInt(1, 900),
      confirmRights: bool('Obligatorio en true: declarás tener derechos para usar la animación.'),
    }, ['confirmRights']),
  },

  // ── Pasada 159: skills del AI Hub ───────────────────────────────────
  {
    name: 'ai_skills_list',
    description: `${READ} Lista las skills del AI Hub: built-in y personalizadas del usuario (id, nombre, resumen, categoría, destino, contrato de salida, flag custom).`,
    inputSchema: obj({
      category: { type: 'string', enum: ['guion', 'crecimiento', 'produccion', 'localizacion', 'motion'] },
      customOnly: bool('true = sólo skills personalizadas'),
    }),
  },
  {
    name: 'ai_skill_compose',
    description: `${READ} Compone el prompt de una skill con un brief: devuelve el texto final (header SKILL/OBJETIVO + CONTEXTO + contrato SALIDA), caracteres, tokens estimados y flag tooLong.`,
    inputSchema: obj({
      skillId: { type: 'string', minLength: 1, maxLength: 120 },
      brief: { type: 'string', minLength: 1, maxLength: 4000 },
    }, ['skillId', 'brief']),
  },
  {
    name: 'custom_skill_save',
    description: `${WRITE} Crea o actualiza una skill personalizada del usuario (plantilla de prompt + destino del AI Hub). Campos: name, summary, category (guion|crecimiento|produccion|localizacion|motion), target (vista destino, ver NAV_VIEWS), output (contrato de salida) y prompt. id se genera del nombre si no se pasa; pasar id existente actualiza.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 120 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      summary: { type: 'string', minLength: 1, maxLength: 4000 },
      category: { type: 'string', enum: ['guion', 'crecimiento', 'produccion', 'localizacion', 'motion'] },
      target: { type: 'string', minLength: 1, maxLength: 40 },
      output: { type: 'string', minLength: 1, maxLength: 200 },
      prompt: { type: 'string', minLength: 1, maxLength: 4000 },
    }, ['name', 'summary', 'category', 'target', 'output', 'prompt']),
  },
  {
    name: 'custom_skill_delete',
    description: `${WRITE} Elimina una skill personalizada del usuario por id.`,
    inputSchema: obj({
      id: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['id']),
  },
  {
    name: 'mcp_tool_schema',
    description: `${READ} Devuelve la ficha completa de una herramienta del catálogo MCP: descripción entera, JSON Schema de arguments y anotaciones de riesgo. Usala antes de llamar una herramienta cuyo contrato no recuerdes: el catálogo del chat sólo trae el índice (nombre + descripción breve + marcas h).`,
    inputSchema: obj({
      name: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['name']),
    annotations: { readOnlyHint: true },
  },
];

const READ_ONLY_TOOL_NAMES = new Set([
  'mcp_tool_schema',
  'ai_skills_list',
  'ai_skill_compose',
  'effect_catalog_get',
  'node_graph_list',
  'node_graph_get',
  'node_graph_validate',
  'keyframe_snapshot',
  'keyframe_capture',
  'keyframe_transform_at',
  'clip_gain_at',
  'caption_text_split',
  'caption_wrap',
  'caption_plan_cues',
  'narration_plan_build',
  'smart_bin_list',
  'assets_smart_bin_filter',
  'luma_mate_candidates',
  'adaptive_profile',
  'beat_detect',
  'beat_ramp_suggest',
  'motion_templates_list',
  'image_traits',
  'visual_plan_assignments',
  'project_quality_evaluate',
  'platform_rules_list',
  'platform_rules_audit',
  'title_templates_list',
  'speed_ramp_presets',
  'effect_presets_list',
  'audio_presets_list',
  'safe_area_presets',
  'clip_source_info',
  'director_memory_get',
  'render_queue_status',
  'project_io_range_get',
  'subtitles_export_content',
  'catalog_favorites_list',
  'video_format_presets',
  'production_plan_from_project',
  'factory_variants_plan',
  'publication_metadata',
  'publication_audit',
  'effect_templates_list',
  'project_search',
  'caption_motion_presets',
  'color_looks_list',
  'export_presets_list',
  'export_size_estimate',
  'grade_presets_list',
  'file_url_absolute',
  'whiteboard_status',
  'system_fonts_list',
  'hardware_encoders',
  'download_disk_space',
  'render_active',
  'audio_provider_get',
  'whisper_model_status',
  'vpn_wireguard',
  'recent_project_thumbnail',
  'recovery_status',
  'preferences_export',
  'effect_catalog_search',
  'effect_stack_list',


  'diagnostics',
  'app_status',
  'project_summary',
  'project_snapshot',
  'timeline_clips',
  'captions_list',
  'assets_list',
  'media_analyze',
  'fs_check',
  'tracks_list',
  'export_profiles',
  'critic_run',
  'factory_job_status',
  'factory_job_list',
  'markers_list',
  'settings_get',
  'review_build',
  'media_folder_list',
  'media_search',
  'fs_list',
  'fs_read',
  'voice_isolation_status',
  'flow_browser_status',
  'flow_embed_status',
  'web_sessions_status',
  'transitions_list',
  'media_thumbnail',
  'scene_detect',
  'stabilization_analyze',
  'sample_asset_color',
  'find_missing_assets',
  'find_duplicate_assets',
  'sfx_library',
  'list_capabilities',
  'export_capabilities',
  'extract_subtitles',
  'mix_loudness_analyze',
  'audio_scope_analyze',
  'file_loudness_measure',
  'voice_list',
  'verify_export',
  'thumbnail_pick',
  'render_diary',
  'project_versions_list',
  'visual_audit',
  'media_probe_file',
  'audio_peaks_path',
  'proxy_status',
  'catalog_search',
  'catalog_get',
  'provider_test',
  'render_queue',
  'vmaf_measure',
  'downloader_status',
  'downloader_bridge_info',
  'download_probe',
  'playlist_entries',
  'audio_tracks_url',
  'sponsorblock_preview',
  'source_checksum',
  'rss_fetch',
  'watch_folder_scan',
  'proxy_test',
  'vpn_list',
  'watchdog_status',
  'platform_rules',
  'youtube_channel_analyze',
  'production_status',
  'production_list',
  'production_plan_from_brief',
  'studio_capabilities',
  'tts_voices',
  'text_fonts_list',
  'subtitles_inspect_file',
  'analyze_face_track',
  'track_object',
  'analyze_images',
  'analyze_media_frames',
  'models_list',
  'check_asset_files',
  'plugins_list',
  'extension_status',
  'system_info',
  'mcp_servers_list',
  'mcp_server_probe',
  'mcp_session_status',
  'mcp_audit_tail',
  'flow_proxies_get',
  'audio_peaks',
  'visual_catalog',
  'quality_gate_review',
  'mcp_server_status',
  'mcp_detect_clients',
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
