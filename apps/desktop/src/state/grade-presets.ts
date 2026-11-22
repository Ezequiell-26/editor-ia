import { ColorGradeSchema, createNeutralLayer, type ColorGrade, type ColorGradeLayer } from '@editor-ia/project-schema';

/**
 * User-saved grade configurations. Follows the same defensive, versioned
 * localStorage pattern as `features/editor/export-presets.ts`. Presets are
 * independent of any project file so they can be reused across projects.
 */

const STORAGE_KEY = 'editoria.color-grade-presets.v1';
const MAX_PRESETS = 40;

export interface GradePreset {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** A whole node graph (save/reuse configurations) or a single layer. */
  readonly grade: ColorGrade | null;
  readonly layer: ColorGradeLayer | null;
}

export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultPresetStorage(): PresetStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Corrupt or hand-edited storage must never crash the Color page. */
export function parseGradePresets(raw: string | null): GradePreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: GradePreset[] = [];
    for (const entry of parsed.slice(0, MAX_PRESETS)) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string') continue;
      const grade = item.grade ? ColorGradeSchema.safeParse(item.grade) : null;
      if (grade && !grade.success) continue;
      out.push({
        id: item.id,
        name: item.name.slice(0, 60),
        createdAt: item.createdAt,
        grade: grade?.success ? grade.data : null,
        layer: (item.layer && typeof item.layer === 'object' ? item.layer : null) as ColorGradeLayer | null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadGradePresets(storage: PresetStorage | null = defaultPresetStorage()): GradePreset[] {
  if (!storage) return [];
  try {
    return parseGradePresets(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function writePresets(presets: GradePreset[], storage: PresetStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function saveGradePreset(
  name: string,
  payload: { readonly grade?: ColorGrade; readonly layer?: ColorGradeLayer },
  storage: PresetStorage | null = defaultPresetStorage(),
): GradePreset[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return loadGradePresets(storage);
  const presets = loadGradePresets(storage).filter(
    (preset) => preset.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  const next: GradePreset[] = [
    {
      id: `grade-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
      grade: payload.grade ?? null,
      layer: payload.layer ?? null,
    },
    ...presets,
  ].slice(0, MAX_PRESETS);
  writePresets(next, storage);
  return next;
}

export function deleteGradePreset(
  id: string,
  storage: PresetStorage | null = defaultPresetStorage(),
): GradePreset[] {
  const next = loadGradePresets(storage).filter((preset) => preset.id !== id);
  writePresets(next, storage);
  return next;
}

/** Module-level clipboard for copy/paste grade between clips (no fake state). */
let gradeClipboard: ColorGrade | null = null;

export function setGradeClipboard(grade: ColorGrade | null): void {
  gradeClipboard = grade ? (JSON.parse(JSON.stringify(grade)) as ColorGrade) : null;
}

export function getGradeClipboard(): ColorGrade | null {
  return gradeClipboard ? (JSON.parse(JSON.stringify(gradeClipboard)) as ColorGrade) : null;
}

export function hasGradeClipboard(): boolean {
  return gradeClipboard !== null;
}

/** Built-in looks. Each entry is a complete, schema-valid layer. */
export function createBuiltinLooks(): readonly { readonly id: string; readonly label: string; readonly layer: ColorGradeLayer }[] {
  const warm = createNeutralLayer();
  warm.primaries.temperature = 0.32;
  warm.primaries.gamma = { r: 0.04, g: 0.01, b: -0.03 };
  warm.primaries.saturation = 1.12;
  warm.hdr.shadows = -0.08;
  warm.hdr.highlights = 0.1;

  const cool = createNeutralLayer();
  cool.primaries.temperature = -0.34;
  cool.primaries.gain = { r: -0.03, g: 0, b: 0.05 };
  cool.primaries.saturation = 0.94;
  cool.primaries.contrast = 0.08;

  const cinema = createNeutralLayer();
  cinema.primaries.contrast = 0.24;
  cinema.primaries.pivot = 0.45;
  cinema.primaries.saturation = 0.9;
  cinema.hdr.shadows = -0.16;
  cinema.hdr.highlights = 0.06;
  cinema.hdr.specular = -0.1;
  cinema.curves.master = [
    { x: 0, y: 0.02 }, { x: 0.25, y: 0.2 }, { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.82 }, { x: 1, y: 0.98 },
  ];

  const bleach = createNeutralLayer();
  bleach.primaries.contrast = 0.32;
  bleach.primaries.saturation = 0.72;
  bleach.primaries.lift = { r: 0.05, g: 0.04, b: 0.02 };
  bleach.hdr.shadows = 0.12;

  const mono = createNeutralLayer();
  mono.primaries.saturation = 0;
  mono.primaries.contrast = 0.16;
  mono.hdr.shadows = -0.12;
  mono.hdr.highlights = 0.14;

  const flat = createNeutralLayer();
  flat.primaries.contrast = -0.28;
  flat.primaries.saturation = 0.86;
  flat.primaries.lift = { r: 0.04, g: 0.04, b: 0.04 };

  return [
    { id: 'neutral', label: 'Neutro', layer: createNeutralLayer() },
    { id: 'warm', label: 'Cálido', layer: warm },
    { id: 'cool', label: 'Frío', layer: cool },
    { id: 'cinema', label: 'Cine', layer: cinema },
    { id: 'bleach', label: 'Bleach', layer: bleach },
    { id: 'flat', label: 'Log plano', layer: flat },
    { id: 'mono', label: 'Monocromo', layer: mono },
  ];
}

export function isValidGrade(grade: unknown): grade is ColorGrade {
  return ColorGradeSchema.safeParse(grade).success;
}

export { STORAGE_KEY as GRADE_PRESETS_KEY, isFiniteNumber };
