import { useEffect, useRef, useState } from 'react';
import type { Clip, ClipEffects } from '@editor-ia/project-schema';
import {
  CAMERA_PROFILE_IDS,
  cameraProfileLut,
  parseCubeLut,
  type Lut3DSource,
} from '@editor-ia/effect-kit';
import type { Lut3DInput } from '@editor-ia/effect-kit';
import { useProjectStore } from '../../state/project-store';
import {
  auditionedEffects,
  type LookAudition,
} from '../../state/look-audition';

/**
 * LUTs 3D de la preview (`effects.cameraProfile` + `effects.lutFile`).
 *
 * El export aplica ambas en la cadena FFmpeg del clip (`plan/range.rs`:
 * camera LUT → clip LUT → glow → stack). La preview las sube como texturas
 * `TEXTURE_3D` al renderer WebGL de `EffectCanvas`, que las evalúa antes del
 * stack — el mismo orden interno. La posición respecto del grade plano es la
 * aproximación ya documentada de `clipPreviewStack` (los filtros CSS se
 * aplican sobre el canvas, no sobre la textura cruda).
 *
 * No cubre: LUT del `project.look` global ni la de clips de ajuste (el
 * export la aplica gateada por ventana sobre la imagen inferior completa).
 */

export type PreviewLutRequest =
  | { readonly kind: 'profile'; readonly id: string }
  | { readonly kind: 'file'; readonly path: string; readonly intensity: number };

const PROFILE_IDS = new Set(CAMERA_PROFILE_IDS);

/** Descriptores de LUT del clip, en el orden en que el export las aplica. */
export function clipPreviewLuts(
  clip: Clip,
  audition: LookAudition | null,
): PreviewLutRequest[] {
  if (!('effects' in clip)) return [];
  const effects = auditionedEffects(clip, audition) as ClipEffects | undefined;
  if (!effects) return [];
  const requests: PreviewLutRequest[] = [];
  const profile = effects.cameraProfile;
  if (profile && PROFILE_IDS.has(profile)) {
    requests.push({ kind: 'profile', id: profile });
  }
  const lutFile = typeof effects.lutFile === 'string' ? effects.lutFile.trim() : '';
  if (lutFile) {
    const intensity = effects.lutIntensity ?? 1;
    // Mismo corte que `effects_lut` del export: intensidad ~0 no aplica.
    if (intensity > 0.001) {
      requests.push({ kind: 'file', path: lutFile, intensity });
    }
  }
  return requests;
}

function sourceToInput(source: Lut3DSource, intensity: number): Lut3DInput {
  return {
    data: source.lut,
    intensity,
    domainMin: source.domainMin,
    domainMax: source.domainMax,
  };
}

const cubeCache = new Map<string, Promise<Lut3DSource | null>>();

function loadCubeLut(url: string): Promise<Lut3DSource | null> {
  const cached = cubeCache.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => (response.ok ? response.text() : null))
    .then((text) => (text ? parseCubeLut(text) : null))
    .catch(() => null);
  cubeCache.set(url, pending);
  return pending;
}

const EMPTY_INPUTS: Lut3DInput[] = [];

/**
 * Resuelve los descriptores a `Lut3DInput` listos para `EffectRenderer.setLuts`.
 * Los `.cube` se piden por `service.mediaUrl` (asset:// del archivo del
 * proyecto) y se cachean por URL; en modo navegador `mediaUrl` devuelve '' y
 * la LUT de archivo simplemente no aparece — honesto, no simulado.
 */
export function usePreviewLuts(requests: readonly PreviewLutRequest[]): Lut3DInput[] {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const requestsKey = JSON.stringify(requests);
  const [inputs, setInputs] = useState<Lut3DInput[]>(EMPTY_INPUTS);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;

  useEffect(() => {
    const list = requestsRef.current;
    if (list.length === 0) {
      setInputs(EMPTY_INPUTS);
      return;
    }
    let alive = true;
    void (async () => {
      const resolved = await Promise.all(
        list.map(async (request): Promise<Lut3DInput | null> => {
          if (request.kind === 'profile') {
            const source = cameraProfileLut(request.id);
            return source ? sourceToInput(source, 1) : null;
          }
          if (!root) return null;
          const url = store.service.mediaUrl(root, request.path);
          if (!url) return null;
          const source = await loadCubeLut(url);
          return source ? sourceToInput(source, request.intensity) : null;
        }),
      );
      if (!alive) return;
      setInputs(resolved.filter((input): input is Lut3DInput => input !== null));
    })();
    return () => {
      alive = false;
    };
    // `requestsKey` cubre cambios de contenido; `root`/`store` son estables
    // por proyecto abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestsKey, root]);

  return inputs;
}
