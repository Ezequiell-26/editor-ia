/**
 * Guías de área segura por plataforma para el monitor de preview.
 *
 * Cada preset describe, en coordenadas normalizadas (0–1 sobre el cuadro),
 * las zonas que la interfaz de la plataforma tapa (`cover`) y el polígono
 * donde el contenido importante debe quedar (`safe`), más un polígono más
 * interno para títulos (`title`, opcional). Son estimaciones de las zonas de
 * UI publicadas por cada red — sirven para componer, no garantizan nada.
 *
 * `aspect` es la relación objetivo del formato (ancho/alto); la preview avisa
 * cuando el proyecto no coincide.
 */

export type SafeAreaPresetId =
  | 'generic'
  | 'youtube'
  | 'tiktok'
  | 'reels'
  | 'stories'
  | 'shorts'
  | 'feed';

/** Rectángulo normalizado: x, y, ancho y alto como fracción del cuadro. */
export interface SafeAreaRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Punto normalizado del polígono. */
export interface SafeAreaPoint {
  readonly x: number;
  readonly y: number;
}

export interface SafeAreaPreset {
  readonly id: SafeAreaPresetId;
  readonly label: string;
  /** Relación objetivo "ancho:alto" para la etiqueta y el aviso de desvío. */
  readonly aspectLabel: string;
  /** ancho/alto del formato destino; null en la guía genérica. */
  readonly aspect: number | null;
  /** Rectángulos que la UI de la plataforma cubre (se sombrean). */
  readonly cover: readonly SafeAreaRect[];
  /** Polígono exterior de la zona segura. */
  readonly safe: readonly SafeAreaPoint[];
  /** Polígono interior recomendado para títulos/logotipos. */
  readonly title?: readonly SafeAreaPoint[];
}

const rect = (x: number, y: number, w: number, h: number): SafeAreaRect => ({ x, y, w, h });
const pts = (...list: ReadonlyArray<readonly [number, number]>): SafeAreaPoint[] =>
  list.map(([x, y]) => ({ x, y }));

export const SAFE_AREA_PRESETS: readonly SafeAreaPreset[] = [
  {
    id: 'generic',
    label: 'Genérica (acción/título)',
    aspectLabel: '',
    aspect: null,
    cover: [],
    safe: [],
  },
  {
    id: 'youtube',
    label: 'YouTube / TV (16:9)',
    aspectLabel: '16:9',
    aspect: 16 / 9,
    cover: [
      rect(0, 0, 1, 0.035),
      rect(0, 0.965, 1, 0.035),
      rect(0, 0.035, 0.035, 0.93),
      rect(0.965, 0.035, 0.035, 0.93),
    ],
    safe: pts([0.035, 0.035], [0.965, 0.035], [0.965, 0.965], [0.035, 0.965]),
    title: pts([0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]),
  },
  {
    id: 'tiktok',
    label: 'TikTok (9:16)',
    aspectLabel: '9:16',
    aspect: 9 / 16,
    cover: [
      rect(0, 0, 1, 0.125),
      rect(0, 0.656, 1, 0.344),
      rect(0, 0.125, 0.111, 0.531),
      rect(0.722, 0.4375, 0.278, 0.21875),
      rect(0.889, 0.125, 0.111, 0.3125),
    ],
    safe: pts(
      [0.111, 0.125],
      [0.889, 0.125],
      [0.889, 0.4375],
      [0.722, 0.4375],
      [0.722, 0.656],
      [0.111, 0.656],
    ),
  },
  {
    id: 'reels',
    label: 'Instagram Reels (9:16)',
    aspectLabel: '9:16',
    aspect: 9 / 16,
    cover: [
      rect(0, 0, 1, 0.14),
      rect(0, 0.65, 1, 0.35),
      rect(0.79, 0.6, 0.21, 0.05),
      rect(0, 0.14, 0.06, 0.51),
      rect(0.94, 0.14, 0.06, 0.46),
    ],
    safe: pts([0.06, 0.14], [0.94, 0.14], [0.94, 0.6], [0.79, 0.6], [0.79, 0.65], [0.06, 0.65]),
  },
  {
    id: 'stories',
    label: 'Historias / Stories (9:16)',
    aspectLabel: '9:16',
    aspect: 9 / 16,
    cover: [rect(0, 0, 1, 250 / 1920), rect(0, 1 - 340 / 1920, 1, 340 / 1920)],
    safe: pts([0.004, 250 / 1920], [0.996, 250 / 1920], [0.996, 1 - 340 / 1920], [0.004, 1 - 340 / 1920]),
  },
  {
    id: 'shorts',
    label: 'YouTube Shorts (9:16)',
    aspectLabel: '9:16',
    aspect: 9 / 16,
    cover: [
      rect(0, 0, 1, 288 / 1920),
      rect(0, 1 - 672 / 1920, 1, 672 / 1920),
      rect(0, 288 / 1920, 48 / 1080, 1 - 960 / 1920),
      rect(1 - 192 / 1080, 288 / 1920, 192 / 1080, 1 - 960 / 1920),
    ],
    safe: pts([48 / 1080, 288 / 1920], [1 - 192 / 1080, 288 / 1920], [1 - 192 / 1080, 1 - 672 / 1920], [48 / 1080, 1 - 672 / 1920]),
  },
  {
    id: 'feed',
    label: 'Feed vertical (4:5)',
    aspectLabel: '4:5',
    aspect: 4 / 5,
    cover: [rect(0, 0, 0.03125, 1), rect(0.96875, 0, 0.03125, 1)],
    safe: pts([0.03125, 0.004], [0.96875, 0.004], [0.96875, 0.996], [0.03125, 0.996]),
  },
];

export const SAFE_AREA_PRESET_IDS: readonly SafeAreaPresetId[] = SAFE_AREA_PRESETS.map(
  (preset) => preset.id,
);

export function safeAreaPresetById(id: string | null | undefined): SafeAreaPreset {
  return SAFE_AREA_PRESETS.find((preset) => preset.id === id) ?? SAFE_AREA_PRESETS[0]!;
}

/** true cuando la relación del proyecto se desvía del formato del preset. */
export function safeAreaAspectMismatch(
  preset: SafeAreaPreset,
  projectWidth: number,
  projectHeight: number,
): boolean {
  if (preset.aspect === null || projectWidth <= 0 || projectHeight <= 0) return false;
  const projectAspect = projectWidth / projectHeight;
  return Math.abs(projectAspect - preset.aspect) / preset.aspect > 0.02;
}

/** `points` listo para el atributo SVG (`x,y x,y …` en porcentaje). */
export function safeAreaPointsAttr(points: readonly SafeAreaPoint[]): string {
  return points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
}
