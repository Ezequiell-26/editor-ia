import {
  CaptionStyleSchema,
  RenderProfileSchema,
  type CaptionStyle,
  type ProjectDocument,
  type RenderProfile,
} from '@editor-ia/project-schema';
import { effectRegistry } from '@editor-ia/effect-kit';
import type { PluginInfo } from '../services/project-service';
import { cloneProject, newId, touch } from './project-actions';
import {
  parseEffectTemplateValue,
  saveEffectTemplate,
  type EffectTemplate,
} from './effect-templates';

/**
 * Contrato de presets de plugins.
 *
 * El manifiesto (`plugin.json`) declara `presets.effects`,
 * `presets.exportProfiles` y `presets.captionStyles` como JSON libre; este
 * módulo es el contrato que los vuelve aplicables. Nada se aplica sin pasar
 * por estas validaciones:
 *
 * - `effects[]`: cada entrada es un documento `olyvia-effect-template` v1
 *   (el mismo formato que exporta el panel de plantillas). Aplicar = importar
 *   la plantilla a la biblioteca del usuario; los `effectId` que ya no
 *   existen en el catálogo se omiten al usarla (se informan como
 *   `unknownEffectIds`).
 * - `exportProfiles[]`: cada entrada es un `RenderProfile` del schema del
 *   proyecto SIN `id` (los ids son uuid v4 y sólo los genera la app). Aplicar
 *   = agregar el perfil a `project.renderProfiles`; un nombre ya existente se
 *   salta, no se duplica.
 * - `captionStyles[]`: cada entrada es un `CaptionStyle` SIN `id`. Aplicar =
 *   agregar el estilo a `project.captions.styles` con la misma deduplicación
 *   por nombre.
 *
 * Las entradas que no cumplen el contrato se informan como inválidas con su
 * motivo; un preset roto no impide aplicar los demás.
 */

export type PluginExportProfile = Omit<RenderProfile, 'id'>;
export type PluginCaptionStyle = Omit<CaptionStyle, 'id'>;

export interface ParsedEffectPreset {
  readonly template: EffectTemplate;
  /** `effectId` del stack que el catálogo actual no conoce. */
  readonly unknownEffectIds: readonly string[];
}

export interface ParsedPluginPresets {
  readonly effects: readonly (ParsedEffectPreset | { readonly error: string })[];
  readonly exportProfiles: readonly (
    | { readonly preset: PluginExportProfile }
    | { readonly error: string }
  )[];
  readonly captionStyles: readonly (
    | { readonly preset: PluginCaptionStyle }
    | { readonly error: string }
  )[];
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
}

function parseEffectPreset(raw: unknown): ParsedEffectPreset | { readonly error: string } {
  const parsed = parseEffectTemplateValue(raw);
  if (!parsed.ok) return { error: parsed.error };
  const unknownEffectIds = [
    ...new Set(
      parsed.template.stack
        .map((instance) => instance.effectId)
        .filter((effectId) => !effectRegistry.get(effectId)),
    ),
  ];
  return { template: parsed.template, unknownEffectIds };
}

function parseProfilePreset(raw: unknown): { preset: PluginExportProfile } | { error: string } {
  if (!isPlainObject(raw)) return { error: 'el perfil no es un objeto' };
  if ('id' in raw) {
    return { error: 'el perfil de plugin no lleva id: lo genera la app al aplicarlo' };
  }
  // El schema exige id (uuid v4): se inyecta uno de validación y se descarta.
  const parsed = RenderProfileSchema.safeParse({ ...raw, id: newId() });
  if (!parsed.success) {
    return { error: `perfil inválido: ${parsed.error.issues[0]?.message ?? 'no cumple el schema'}` };
  }
  const { id: _id, ...preset } = parsed.data;
  return { preset };
}

function parseStylePreset(raw: unknown): { preset: PluginCaptionStyle } | { error: string } {
  if (!isPlainObject(raw)) return { error: 'el estilo no es un objeto' };
  if ('id' in raw) {
    return { error: 'el estilo de plugin no lleva id: lo genera la app al aplicarlo' };
  }
  const parsed = CaptionStyleSchema.safeParse({ ...raw, id: newId() });
  if (!parsed.success) {
    return { error: `estilo inválido: ${parsed.error.issues[0]?.message ?? 'no cumple el schema'}` };
  }
  const { id: _id, ...preset } = parsed.data;
  return { preset };
}

/** Valida los tres grupos de presets de un plugin; no aplica nada. */
export function parsePluginPresets(plugin: PluginInfo): ParsedPluginPresets {
  const { presets } = plugin;
  return {
    effects: presets.effects.map(parseEffectPreset),
    exportProfiles: presets.exportProfiles.map(parseProfilePreset),
    captionStyles: presets.captionStyles.map(parseStylePreset),
  };
}

export function countPluginPresets(parsed: ParsedPluginPresets): {
  readonly valid: number;
  readonly invalid: number;
} {
  const groups = [parsed.effects, parsed.exportProfiles, parsed.captionStyles];
  let valid = 0;
  let invalid = 0;
  for (const group of groups) {
    for (const entry of group) {
      if ('error' in entry) invalid += 1;
      else valid += 1;
    }
  }
  return { valid, invalid };
}

/**
 * Importa una plantilla de efectos a la biblioteca del usuario (misma
 * persistencia que el panel de plantillas). Devuelve la lista actualizada.
 */
export function importPluginEffectTemplate(
  template: EffectTemplate,
  storage?: Storage,
): ReturnType<typeof saveEffectTemplate> {
  return saveEffectTemplate(template.name, template.kind, template.stack, storage);
}

export interface PluginProjectPresetResult {
  readonly project: ProjectDocument;
  readonly added: number;
  readonly skipped: number;
}

/**
 * Agrega perfiles de exportación al proyecto. Los nombres repetidos se saltan
 * (no se duplican perfiles); los agregados reciben id uuid nuevo.
 */
export function applyPluginExportProfiles(
  project: ProjectDocument,
  presets: readonly PluginExportProfile[],
): PluginProjectPresetResult {
  const taken = new Set(project.renderProfiles.map((profile) => profile.name.toLowerCase()));
  const fresh = presets.filter((preset) => {
    const key = preset.name.toLowerCase();
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
  if (fresh.length === 0) {
    return { project, added: 0, skipped: presets.length };
  }
  const next = cloneProject(project);
  for (const preset of fresh) {
    next.renderProfiles.push({ ...preset, id: newId() });
  }
  touch(next);
  return { project: next, added: fresh.length, skipped: presets.length - fresh.length };
}

/** Agrega estilos de subtítulo al proyecto con la misma deduplicación por nombre. */
export function applyPluginCaptionStyles(
  project: ProjectDocument,
  presets: readonly PluginCaptionStyle[],
): PluginProjectPresetResult {
  const taken = new Set(project.captions.styles.map((style) => style.name.toLowerCase()));
  const fresh = presets.filter((preset) => {
    const key = preset.name.toLowerCase();
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
  if (fresh.length === 0) {
    return { project, added: 0, skipped: presets.length };
  }
  const next = cloneProject(project);
  for (const preset of fresh) {
    next.captions.styles.push({ ...preset, id: newId() });
  }
  touch(next);
  return { project: next, added: fresh.length, skipped: presets.length - fresh.length };
}

