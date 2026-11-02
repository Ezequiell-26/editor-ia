import type { ProjectDocument } from '@editor-ia/project-schema';
import type {
  BeatGrid,
  EditProposal,
  IntentProfile,
  Shot,
  TimelineSignals,
} from './types.ts';

/**
 * Políticas de edición.
 *
 * Cada política es una función pura que mira las señales y devuelve propuestas.
 * Están separadas a propósito: se pueden probar de a una, discutir de a una y
 * apagar de a una sin tocar el resto del cerebro.
 */

export interface PolicyContext {
  readonly project: ProjectDocument;
  readonly signals: TimelineSignals;
  readonly profile: IntentProfile;
  /** Grilla de beats ya mapeada a frames, si el usuario la calculó. */
  readonly beats?: BeatGrid;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function trackName(project: ProjectDocument, trackId: string): string {
  return project.timeline.tracks.find((track) => track.id === trackId)?.label ?? 'pista';
}

function clipLabel(project: ProjectDocument, clipId: string): string {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return 'clip';
  if (clip.label) return clip.label;
  const source = clip.source;
  if (source.type === 'asset') {
    const asset = project.assets.find((item) => item.id === source.assetId);
    if (asset?.label) return asset.label;
  }
  return clip.kind;
}

/** Huecos entre clips: el primer arreglo de cualquier timeline. */
export function gapsPolicy({ project, signals }: PolicyContext): EditProposal[] {
  const byTrack = new Map<string, number>();
  for (const gap of signals.gaps) {
    byTrack.set(gap.trackId, (byTrack.get(gap.trackId) ?? 0) + gap.seconds);
  }
  return [...byTrack.entries()]
    .filter(([, seconds]) => seconds >= 0.2)
    .map(([trackId, seconds]) => ({
      id: `close-gaps:${trackId}`,
      kind: 'close-gaps' as const,
      title: `Cerrar ${round(seconds, 1)} s de hueco`,
      reason: `La pista «${trackName(project, trackId)}» tiene silencios entre clips que cortan el ritmo sin aportar nada.`,
      confidence: 0.92,
      impact: Math.min(1, seconds / 4),
      risk: 'safe' as const,
      clipIds: signals.gaps.filter((gap) => gap.trackId === trackId).map((gap) => gap.beforeClipId),
      payload: { kind: 'close-gaps' as const, trackId },
      preview: `Se mueven los clips de «${trackName(project, trackId)}» para que queden pegados.`,
    }));
}

/** Planos demasiado cortos: no se leen, sólo parpadean. */
export function shortShotPolicy({ project, signals, profile }: PolicyContext): EditProposal[] {
  if (profile.minShotSeconds <= 0) return [];
  const first = signals.visualShots[0];
  const last = signals.visualShots[signals.visualShots.length - 1];
  const offenders = signals.visualShots.filter(
    (shot) =>
      shot.seconds < profile.minShotSeconds &&
      shot.clipId !== first?.clipId &&
      shot.clipId !== last?.clipId,
  );
  if (offenders.length === 0) return [];
  const removed = offenders.reduce((total, shot) => total + shot.seconds, 0);
  return [
    {
      id: 'drop-short',
      kind: 'drop-short',
      title: `Quitar ${offenders.length} plano${offenders.length === 1 ? '' : 's'} de menos de ${profile.minShotSeconds} s`,
      reason: `Un plano por debajo de ${profile.minShotSeconds} s no alcanza a leerse: se percibe como un salto.`,
      confidence: 0.78,
      impact: Math.min(1, removed / 3),
      risk: 'moderate',
      clipIds: offenders.map((shot) => shot.clipId),
      payload: {
        kind: 'delete',
        clipIds: offenders.slice(0, 8).map((shot) => shot.clipId),
      },
      preview: `Se eliminan ${offenders.length} clips y se liberan ${round(removed, 1)} s.`,
    },
  ];
}

/** Planos demasiado largos para el ritmo objetivo. */
export function longShotPolicy({ project, signals, profile, beats }: PolicyContext): EditProposal[] {
  if (profile.maxShotSeconds <= 0) return [];
  // Con una grilla de beats usable, cortar en el tiempo justo suena peor que
  // cortar en el pulso: lo resuelve `beatPolicy`.
  if (beats && beats.confidence >= 0.4) return [];
  const targets = signals.visualShots
    .filter((shot) => shot.seconds > profile.maxShotSeconds * 1.05)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 4);

  return targets.map((shot) => {
    const pieces = Math.max(2, Math.ceil(shot.seconds / profile.maxShotSeconds));
    const pieceFrames = Math.floor(shot.durationFrames / pieces);
    const atFrames: number[] = [];
    for (let index = 1; index < pieces; index += 1) {
      atFrames.push(shot.startFrame + pieceFrames * index);
    }
    return {
      id: `split-long:${shot.clipId}`,
      kind: 'split-long' as const,
      title: `Partir «${clipLabel(project, shot.clipId)}» en ${pieces} planos`,
      reason: `Dura ${round(shot.seconds, 1)} s y el objetivo de este formato es ${profile.maxShotSeconds} s por plano. Partirlo crea ritmo sin cambiar el contenido.`,
      confidence: 0.82,
      impact: Math.min(1, (shot.seconds - profile.maxShotSeconds) / Math.max(1, shot.seconds)),
      risk: 'safe' as const,
      clipIds: [shot.clipId],
      payload: { kind: 'split' as const, clipId: shot.clipId, atFrames },
      preview: `${pieces} planos de ~${round(shot.durationFrames / pieces / signals.fps, 1)} s.`,
    };
  });
}

/** Gancho: los primeros segundos tienen que tener movimiento propio. */
export function hookPolicy({ project, signals, profile }: PolicyContext): EditProposal[] {
  if (profile.hookCuts <= 0) return [];
  const first = signals.visualShots[0];
  if (!first) return [];
  if (signals.hook.cuts >= profile.hookCuts) return [];
  if (first.seconds < 1.4) return [];

  const cuts: number[] = [];
  for (let index = 1; index <= profile.hookCuts; index += 1) {
    const frame = first.startFrame + Math.round(index * 1.2 * signals.fps);
    if (frame < first.startFrame + first.durationFrames - 2) cuts.push(frame);
  }
  if (cuts.length === 0) return [];

  return [
    {
      id: 'hook-cut',
      kind: 'hook-cut',
      title: `Crear ${cuts.length} corte${cuts.length === 1 ? '' : 's'} en el gancho`,
      reason: `El primer plano dura ${round(first.seconds, 1)} s y no hay cortes en los primeros 3 s. Este formato pide ${profile.hookCuts} para retener.`,
      confidence: 0.7,
      impact: 0.65,
      risk: 'moderate',
      clipIds: [first.clipId],
      payload: { kind: 'split', clipId: first.clipId, atFrames: cuts },
      preview: `Cortes en ${cuts.map((frame) => round((frame - first.startFrame) / signals.fps, 1)).join(' s · ')} s del primer plano.`,
    },
  ];
}

/**
 * Cortes en el pulso.
 *
 * A diferencia de `longShotPolicy`, que parte en el tiempo aritmético, acá los
 * cortes caen sobre la grilla de beats. Se toma uno de cada N beats para que el
 * plano dure cerca del objetivo del formato y no un pulso suelto.
 */
export function beatPolicy({ project, signals, profile, beats }: PolicyContext): EditProposal[] {
  if (!beats || beats.confidence < 0.4) return [];
  const grid = [...beats.beatsFrames].sort((a, b) => a - b);
  if (grid.length < 3) return [];

  const intervals: number[] = [];
  for (let index = 1; index < grid.length; index += 1) {
    const previous = grid[index - 1];
    const current = grid[index];
    if (previous === undefined || current === undefined) continue;
    const delta = current - previous;
    if (delta > 1) intervals.push(delta);
  }
  if (intervals.length === 0) return [];
  const beatFrames = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
  if (!beatFrames || beatFrames < 2) return [];

  const targetFrames = Math.max(beatFrames, Math.round((profile.maxShotSeconds || 4) * signals.fps));
  const stride = Math.max(1, Math.round(targetFrames / beatFrames));

  const candidates = signals.visualShots
    .filter((shot) => shot.durationFrames > beatFrames * 2)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3);

  const proposals: EditProposal[] = [];
  for (const shot of candidates) {
    const start = shot.startFrame;
    const end = start + shot.durationFrames;
    const margin = Math.max(2, Math.round(beatFrames * 0.25));
    const inside = grid.filter((frame) => frame > start + margin && frame < end - margin);
    if (inside.length === 0) continue;
    const atFrames = inside.filter((_, index) => index % stride === 0).slice(0, 6);
    if (atFrames.length === 0) continue;
    proposals.push({
      id: `beat-cut:${shot.clipId}`,
      kind: 'beat-cut',
      title: `Cortar «${clipLabel(project, shot.clipId)}» en el pulso`,
      reason: `La grilla marca ${Math.round(beats.bpm)} BPM (confianza ${Math.round(beats.confidence * 100)} %) y este plano de ${round(shot.seconds, 1)} s no tiene cortes internos.`,
      confidence: Math.min(0.9, beats.confidence * 0.9),
      impact: Math.min(1, (shot.seconds - targetFrames / signals.fps) / Math.max(1, shot.seconds)),
      risk: 'moderate',
      clipIds: [shot.clipId],
      payload: { kind: 'split', clipId: shot.clipId, atFrames },
      preview: `${atFrames.length} cortes sobre beats, uno cada ${stride} pulso(s).`,
    });
  }
  return proposals;
}

/** Transiciones: sólo donde el formato las pide y hay cortes suficientes. */
export function transitionPolicy({ signals, profile }: PolicyContext): EditProposal[] {
  if (profile.transitions === 'none') return [];
  if (signals.transitions > 0) return [];
  if (signals.cutCount < 3) return [];
  const frames = profile.transitions === 'frequent' ? 10 : 8;
  return [
    {
      id: 'transitions',
      kind: 'transition',
      title: `Disolver ${signals.cutCount} cortes`,
      reason: `Hay ${signals.cutCount} cortes duros y ninguna transición; en este formato el corte seco se siente abrupto.`,
      confidence: 0.62,
      impact: 0.45,
      risk: 'moderate',
      clipIds: [],
      payload: { kind: 'transition', type: 'dissolve', frames },
      preview: `Disolvencia de ${frames} frames en cada corte.`,
    },
  ];
}

/** Subtítulos: cobertura mínima para el formato. */
export function captionsPolicy({ signals, profile }: PolicyContext): EditProposal[] {
  if (!profile.captionsRequired) return [];
  // Sin planos no hay nada que subtitular: el aviso sería ruido.
  if (signals.visualShots.length === 0) return [];
  if (signals.captions.coverage >= 0.5) return [];
  const percent = Math.round(signals.captions.coverage * 100);
  return [
    {
      id: 'captions',
      kind: 'captions',
      title: 'Faltan subtítulos',
      reason: `La cobertura es ${percent} % y este formato se mira sin sonido. No se puede resolver solo: hace falta transcribir.`,
      confidence: 0.9,
      impact: 0.8,
      risk: 'safe',
      clipIds: [],
      preview: 'Abrí Texto o Localización para transcribir y volver.',
    },
  ];
}

/** Loudness: sin objetivo declarado el export queda a merced del material. */
export function loudnessPolicy({ signals, profile }: PolicyContext): EditProposal[] {
  if (signals.loudnessTarget) return [];
  if (signals.durationSeconds < 1) return [];
  const platform = profile.id === 'short' ? 'shorts' : profile.id === 'reel' ? 'reels' : 'youtube';
  return [
    {
      id: 'loudness',
      kind: 'loudness',
      title: 'Fijar objetivo de loudness',
      reason: 'El proyecto no declara loudness objetivo, así que dos exports pueden sonar distinto.',
      confidence: 0.85,
      impact: 0.4,
      risk: 'safe',
      clipIds: [],
      payload: { kind: 'loudness', platform, integratedLufs: -14, truePeakDb: -1 },
      preview: `${platform} · -14 LUFS integrados · -1 dBTP.`,
    },
  ];
}

/** Variedad: tres planos seguidos del mismo material se leen como uno solo. */
export function varietyPolicy({ project, signals }: PolicyContext): EditProposal[] {
  return signals.repeatedRuns.slice(0, 3).map((run, index) => {
    const first = run[0] as Shot;
    return {
      id: `variety:${index}`,
      kind: 'variety' as const,
      title: `${run.length} planos seguidos del mismo material`,
      reason: `«${clipLabel(project, first.clipId)}» se repite ${run.length} veces sin cambiar de fuente.`,
      confidence: 0.6,
      impact: 0.3,
      risk: 'safe' as const,
      clipIds: run.map((shot) => shot.clipId),
      preview: 'Sugerencia: intercalar otro ángulo o acortar la repetición.',
    };
  });
}

/** Cierre: un último plano de menos de un segundo no se registra. */
export function endingPolicy({ signals }: PolicyContext): EditProposal[] {
  if (signals.durationSeconds < 5) return [];
  if (signals.ending.lastShotSeconds >= 1 || signals.ending.lastShotSeconds === 0) return [];
  return [
    {
      id: 'ending',
      kind: 'ending',
      title: 'El cierre es muy corto',
      reason: `El último plano dura ${round(signals.ending.lastShotSeconds, 2)} s; por debajo de 1 s el corte final se siente un error.`,
      confidence: 0.65,
      impact: 0.3,
      risk: 'safe',
      clipIds: [],
      preview: 'Sugerencia: estirá el último plano o agregá un cierre de 1,5 s.',
    },
  ];
}

export const POLICIES = [
  gapsPolicy,
  shortShotPolicy,
  longShotPolicy,
  beatPolicy,
  hookPolicy,
  transitionPolicy,
  captionsPolicy,
  loudnessPolicy,
  varietyPolicy,
  endingPolicy,
] as const;
