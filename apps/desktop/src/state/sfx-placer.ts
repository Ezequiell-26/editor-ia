import type {
  Asset,
  Clip,
  ProjectDocument,
} from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  cloneProject,
  fpsOf,
  newId,
  touch,
  updateClip,
} from './project-actions';

export type BuiltinSfxId =
  | 'sfx-woosh'
  | 'sfx-boom'
  | 'sfx-ding'
  | 'sfx-pop'
  | 'sfx-click'
  | 'sfx-riser'
  | 'sfx-glitch'
  | 'sfx-subdrop';

export interface SfxPresetDefinition {
  readonly id: BuiltinSfxId;
  readonly file: string;
  readonly label: string;
  readonly durationSeconds: number;
  readonly description: string;
  readonly defaultGainDb: number;
}

export const SFX_CATALOG: Record<BuiltinSfxId, SfxPresetDefinition> = {
  'sfx-woosh': {
    id: 'sfx-woosh',
    file: 'sfx-woosh.wav',
    label: 'Woosh Rápido',
    durationSeconds: 0.45,
    description: 'Transición dinámica de aire / zoom punch-in',
    defaultGainDb: -6,
  },
  'sfx-boom': {
    id: 'sfx-boom',
    file: 'sfx-boom.wav',
    label: 'Impacto Boom',
    durationSeconds: 1.2,
    description: 'Golpe grave cinematográfico para el hook o cortes mayores',
    defaultGainDb: -5,
  },
  'sfx-ding': {
    id: 'sfx-ding',
    file: 'sfx-ding.wav',
    label: 'Ding Campana',
    durationSeconds: 0.7,
    description: 'Notificación de atención para cifras, estadísticas o palabras clave',
    defaultGainDb: -7,
  },
  'sfx-pop': {
    id: 'sfx-pop',
    file: 'sfx-pop.wav',
    label: 'Pop Burbuja',
    durationSeconds: 0.22,
    description: 'Aparición de emojis, stickers o elementos gráficos',
    defaultGainDb: -6,
  },
  'sfx-click': {
    id: 'sfx-click',
    file: 'sfx-click.wav',
    label: 'Click Táctil',
    durationSeconds: 0.08,
    description: 'Pulsación sutil de interfaz',
    defaultGainDb: -8,
  },
  'sfx-riser': {
    id: 'sfx-riser',
    file: 'sfx-riser.wav',
    label: 'Riser Tensión',
    durationSeconds: 2.0,
    description: 'Crescendo para anticipación',
    defaultGainDb: -8,
  },
  'sfx-glitch': {
    id: 'sfx-glitch',
    file: 'sfx-glitch.wav',
    label: 'Glitch Digital',
    durationSeconds: 0.5,
    description: 'Interferencia cibernética o corte rápido',
    defaultGainDb: -7,
  },
  'sfx-subdrop': {
    id: 'sfx-subdrop',
    file: 'sfx-subdrop.wav',
    label: 'Sub-Drop',
    durationSeconds: 1.8,
    description: 'Bajo envolvente para remates y punchlines',
    defaultGainDb: -6,
  },
};

/**
 * Garantiza que el asset de audio para el efecto SFX exista en el proyecto.
 * Reusa el existente si ya está registrado para evitar duplicados.
 */
export function ensureSfxAsset(
  project: ProjectDocument,
  presetId: BuiltinSfxId,
): { project: ProjectDocument; asset: Asset } {
  const def = SFX_CATALOG[presetId];
  if (!def) {
    throw new Error(`el efecto de sonido "${presetId}" no existe en el catálogo`);
  }

  const existing = project.assets.find(
    (a) =>
      a.kind === 'audio' &&
      ((a.rights?.provenance?.provider === 'sfx' &&
        a.source?.type === 'local' &&
        a.source.path.endsWith(def.file)) ||
        a.tags?.includes(`sfx:${def.id}`)),
  );
  if (existing) {
    return { project, asset: existing };
  }

  const fps = fpsOf(project);
  const now = new Date().toISOString();
  const assetId = newId();

  const newAsset: Asset = {
    id: assetId,
    label: def.label,
    kind: 'audio',
    status: 'ready',
    source: { type: 'local', path: `resources/sfx/${def.file}` },
    integrity: { sha256: '0'.repeat(64), bytes: 20_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: {
        origin: 'template-default',
        provider: 'sfx',
        acquiredAt: now,
      },
    },
    tags: [`sfx:${def.id}`],
    media: {
      sampleRate: 44100,
      channels: 1,
      durationFrames: Math.max(1, Math.round(def.durationSeconds * fps)),
    },
  } as Asset;

  const next = addAsset(project, newAsset);
  return { project: next, asset: newAsset };
}

export interface PlacedSfxEvent {
  readonly frame: number;
  readonly presetId: BuiltinSfxId;
  readonly reason: 'zoom' | 'transition' | 'hook' | 'highlight' | 'emoji';
  readonly clipId: string;
}

export interface AutoPlaceSfxOptions {
  /** Coloca woosh en punch-in zooms (por defecto: true). */
  readonly zooms?: boolean;
  /** Coloca woosh en transiciones entre cortes (por defecto: true). */
  readonly transitions?: boolean;
  /** Coloca ding o pop en subtítulos clave / emojis / números (por defecto: true). */
  readonly captions?: boolean;
  /** Coloca boom de apertura en el gancho inicial (por defecto: true). */
  readonly hook?: boolean;
  /**
   * Separación mínima en fotogramas entre dos efectos de sonido para evitar
   * saturación auditiva (por defecto ~1.2 segundos según FPS).
   */
  readonly minIntervalFrames?: number;
  /** Ganancia adicional en dB para los SFX colocados (por defecto 0 dB respecto al preset). */
  readonly gainDb?: number;
  /** Nombre de la pista de audio donde se montan los SFX. */
  readonly trackName?: string;
}

export interface AutoPlaceSfxResult {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly placedCount: number;
  readonly events: readonly PlacedSfxEvent[];
}

// Palabras que disparan interés en subtítulos para colocar un 'ding'
const HIGHLIGHT_REGEX =
  /(?:\d+[\d.,]*%?|\$\d+|\b(?:importante|clave|secreto|truco|atenci[oó]n|ojo|cuidado|nunca|siempre|resultado|éxito|error|descubr|ganar|perder|mejor|peor|incre[ií]ble|wow)\b|!)/i;

// Regex para detectar emojis comunes
const EMOJI_REGEX =
  /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

/**
 * Escanea la línea de tiempo y coloca automáticamente efectos de sonido
 * (wooshes en zooms/transiciones, dings en cifras y puntos clave, booms en aperturas)
 * en una pista de audio dedicada, con espaciado inteligente y mezcla equilibrada.
 */
export function autoPlaceSfx(
  project: ProjectDocument,
  options: AutoPlaceSfxOptions = {},
): AutoPlaceSfxResult {
  const fps = fpsOf(project);
  const minInterval = Math.max(
    6,
    options.minIntervalFrames ?? Math.round(fps * 1.2),
  );
  const gainOffset = options.gainDb ?? 0;

  let next = cloneProject(project);

  // Crear o reusar la pista de audio de SFX
  const trackName = options.trackName ?? 'Auto · SFX';
  let track = next.timeline.tracks.find(
    (t) => t.kind === 'audio' && t.label === trackName,
  );
  if (!track) {
    const created = addTrack(next, 'audio', trackName);
    next = created.project;
    track = next.timeline.tracks.find((t) => t.id === created.trackId)!;
  }
  const trackId = track.id;

  interface DesiredCue {
    readonly frame: number;
    readonly presetId: BuiltinSfxId;
    readonly reason: 'zoom' | 'transition' | 'hook' | 'highlight' | 'emoji';
  }
  const candidates: DesiredCue[] = [];

  const videoClips = next.timeline.clips.filter(
    (c): c is Clip & { kind: 'video' } => c.kind === 'video',
  );

  // 1. Gancho inicial (Frame 0)
  if (options.hook !== false && videoClips.length > 0) {
    candidates.push({ frame: 0, presetId: 'sfx-boom', reason: 'hook' });
  }

  // 2. Transiciones y Zooms
  for (const [index, clip] of videoClips.entries()) {
    // Transiciones de entrada (a partir del segundo clip)
    if (options.transitions !== false && index > 0 && clip.transitionIn) {
      candidates.push({
        frame: clip.startFrame,
        presetId: 'sfx-woosh',
        reason: 'transition',
      });
    }

    // Zooms: clips con keyframes que amplían la escala
    if (options.zooms !== false && clip.transform?.keyframes) {
      const hasZoom = clip.transform.keyframes.some(
        (kf) => kf.scale !== undefined && kf.scale > 1.05,
      );
      if (hasZoom) {
        // Colocar al inicio del clip (donde se dispara el punch-in)
        candidates.push({
          frame: clip.startFrame,
          presetId: 'sfx-woosh',
          reason: 'zoom',
        });
      }
    }
  }

  // 3. Subtítulos destacados (cifras, palabras clave, emojis)
  if (options.captions !== false && next.captions.cues.length > 0) {
    for (const cue of next.captions.cues) {
      const text = cue.text;
      if (EMOJI_REGEX.test(text)) {
        candidates.push({
          frame: cue.startFrame,
          presetId: 'sfx-pop',
          reason: 'emoji',
        });
      } else if (HIGHLIGHT_REGEX.test(text)) {
        candidates.push({
          frame: cue.startFrame,
          presetId: 'sfx-ding',
          reason: 'highlight',
        });
      }
    }
  }

  // Ordenar candidatos cronológicamente
  candidates.sort((a, b) => a.frame - b.frame);

  // Filtrar con espaciado mínimo para que la mezcla no sea cacofónica
  const accepted: DesiredCue[] = [];
  let lastFrame = -Infinity;

  for (const candidate of candidates) {
    if (candidate.frame - lastFrame >= minInterval) {
      accepted.push(candidate);
      lastFrame = candidate.frame;
    }
  }

  const events: PlacedSfxEvent[] = [];

  for (const item of accepted) {
    const { project: withAsset, asset } = ensureSfxAsset(next, item.presetId);
    next = withAsset;

    const def = SFX_CATALOG[item.presetId];
    const durationFrames = Math.max(
      1,
      Math.round(def.durationSeconds * fps),
    );

    const added = addClipFromAsset(next, asset, {
      trackId,
      atFrame: item.frame,
      durationFrames,
    });
    next = added.project;

    // Aplicar ganancia del preset + offset solicitado
    const totalGain = def.defaultGainDb + gainOffset;
    next = updateClip(next, added.clipId, {
      label: `SFX · ${def.label}`,
      audio: {
        gainDb: totalGain,
      },
    });

    events.push({
      frame: item.frame,
      presetId: item.presetId,
      reason: item.reason,
      clipId: added.clipId,
    });
  }

  touch(next);
  return {
    project: next,
    trackId,
    placedCount: events.length,
    events,
  };
}
