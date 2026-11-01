import { useSyncExternalStore } from 'react';
import type { ClipEffects } from '@editor-ia/project-schema';

export type PreviewProfile = 'efficient' | 'balanced' | 'maximum';

export const PREVIEW_PROFILE_KEY = 'olyvia.preview.profile';

export const PREVIEW_PROFILES: readonly {
  readonly id: PreviewProfile;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: 'efficient',
    label: 'Eficiente',
    description: 'Limita desenfoque y nitidez y apaga el denoise temporal para equipos modestos.',
  },
  {
    id: 'balanced',
    label: 'Equilibrado',
    description: 'Calidad y consumo equilibrados (predeterminado).',
  },
  {
    id: 'maximum',
    label: 'Máximo',
    description: 'Sin límites de preview; el export nunca cambia.',
  },
];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadPreviewProfile(source: StorageLike | undefined = storage()): PreviewProfile {
  const value = source?.getItem(PREVIEW_PROFILE_KEY);
  return value === 'efficient' || value === 'balanced' || value === 'maximum'
    ? value
    : 'balanced';
}

export function savePreviewProfile(
  profile: PreviewProfile,
  target: StorageLike | undefined = storage(),
): void {
  try {
    target?.setItem(PREVIEW_PROFILE_KEY, profile);
  } catch {
    // Preferencia no crítica.
  }
}

const listeners = new Set<() => void>();

export function getPreviewProfile(): PreviewProfile {
  return loadPreviewProfile();
}

export function setPreviewProfile(profile: PreviewProfile): void {
  savePreviewProfile(profile);
  for (const listener of listeners) listener();
}

export function subscribePreviewProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreviewProfile(): PreviewProfile {
  return useSyncExternalStore(
    subscribePreviewProfile,
    getPreviewProfile,
    getPreviewProfile,
  );
}

/**
 * El temporal del denoise sube el frame anterior como textura y consume más
 * CPU/GPU que el pase espacial (0,52 vs 0,36 núcleos y 23,5 vs 19,6 % de GPU
 * en la medición pareada). El perfil Eficiente conserva el espacial y apaga
 * sólo esa pasada; el export no cambia.
 */
export function temporalDenoiseForProfile(profile: PreviewProfile): boolean {
  return profile !== 'efficient';
}

/**
 * El perfil sólo adapta la preview: el export conserva el valor completo del
 * proyecto. `efficient` y `balanced` acotan el gaussiano, que es el filtro CSS
 * más caro en la vista en vivo.
 */
export function adaptEffectsForPreview(
  effects: ClipEffects | undefined,
  profile: PreviewProfile,
): ClipEffects | undefined {
  if (!effects || profile === 'maximum') return effects;
  const cap = profile === 'efficient' ? 4 : 20;
  const sharpenCap = profile === 'efficient' ? 0.35 : 1;
  const patch: Partial<ClipEffects> = {};
  if (effects.blur !== undefined && effects.blur > cap) patch.blur = cap;
  if (effects.sharpen !== undefined && effects.sharpen > sharpenCap) {
    patch.sharpen = sharpenCap;
  }
  const glowCap = profile === 'efficient' ? 8 : 20;
  if (effects.glow && effects.glow.radius > glowCap) {
    patch.glow = { ...effects.glow, radius: glowCap };
  }
  if (Object.keys(patch).length === 0) return effects;
  return { ...effects, ...patch };
}
