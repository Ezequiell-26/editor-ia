import type { RenderDiaryEntry } from '../../services/contracts/render';

/**
 * Clasificación de motivos de fallo del registro de exports — paridad de la
 * "clasificación de motivos" de `export_diario.js` de AlaukCut (prazo /
 * media / GPU / disco). El diary de Rust emite pocos códigos
 * (`RENDER_FAILED`, `RENDER_CANCELLED`, errores de verify/publish), así que
 * el motivo se infiere por palabras clave del `message`/`code`, en
 * minúsculas y sin acentos.
 */
export type DiaryMotive =
  | 'gpu'
  | 'timeout'
  | 'media'
  | 'verify'
  | 'disk'
  | 'other';

export interface DiaryMotiveInfo {
  readonly kind: DiaryMotive;
  readonly label: string;
}

const MOTIVE_LABELS: Record<DiaryMotive, string> = {
  gpu: 'GPU/encoder',
  timeout: 'Tiempo agotado',
  media: 'Medio/codec',
  verify: 'Verificación',
  disk: 'Disco/ESCRITURA',
  other: 'Error',
};

const PATTERNS: ReadonlyArray<readonly [DiaryMotive, RegExp]> = [
  [
    'gpu',
    /gpu|placa|nvenc|qsv|amf|cuda|\bhip\b|vulkan|direct3d|dxgi|\bd3d|driver|hardware encoder|encoder de hardware|device.?removed/i,
  ],
  [
    'timeout',
    /timed?\s*out|timeout|deadline|tiempo agotado|elapsed|colg/i,
  ],
  // `verify` antes que `media`: los errores de verificación/publicación
  // suelen mencionar `ffprobe`/`ffmpeg` y deben clasificarse como tales.
  [
    'verify',
    /verific|probe|duration|duracion|expected|\besperad|publish|publicar|renombr|rename/i,
  ],
  [
    'media',
    /codec|decode|demux|mux|formato|moov|atom|stream|ffmpeg|ffprobe|invalid data|not found|no such|corrupt/i,
  ],
  [
    'disk',
    /space|disco|disk|permission|permiso|denied|denegad|access|escritura|write|read.?only|carpeta|folder/i,
  ],
];

/** Devuelve el motivo clasificado de una entrada fallida del diary. */
export function classifyDiaryEntry(entry: RenderDiaryEntry): DiaryMotiveInfo {
  if (entry.status !== 'failed') {
    return { kind: 'other', label: '' };
  }
  const haystack = `${entry.code ?? ''} ${entry.message ?? ''}`;
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(haystack)) {
      return { kind, label: MOTIVE_LABELS[kind] };
    }
  }
  return { kind: 'other', label: MOTIVE_LABELS.other };
}
