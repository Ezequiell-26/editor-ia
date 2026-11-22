import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import type { Clip, ClipEffects } from '@editor-ia/project-schema';
import { updateClip } from '../../../state/project-actions';
import { useProjectStore } from '../../../state/project-store';
import { InspectorSection as Section } from '../InspectorSection';
import { NumberField } from './fields';

/**
 * Sección «Relight por rostro» del inspector de clip. Extraída de
 * `Inspector.tsx` sin cambiar comportamiento ni textos visibles.
 *
 * Los estados `relightBusy`/`relightError` viven acá: el efecto de reset
 * del padre nunca los tocó, así que la persistencia entre clips es la
 * misma (el componente sigue montado mientras el clip sea visual).
 */
export function RelightSection({ clip }: { readonly clip: Clip }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [relightBusy, setRelightBusy] = useState(false);
  const [relightError, setRelightError] = useState<string | null>(null);
  const source = clip.source;
  const asset =
    source.type === 'asset'
      ? project?.assets.find((item) => item.id === source.assetId)
      : undefined;
  const windowedSource =
    source.type === 'asset' && 'inFrame' in source ? source : undefined;
  const effects: ClipEffects = 'effects' in clip ? clip.effects ?? {} : {};

  function setEffect<K extends keyof ClipEffects>(
    key: K,
    value: ClipEffects[K] | undefined,
  ): void {
    const nextEffects: ClipEffects = { ...effects };
    if (value === undefined) {
      delete nextEffects[key];
    } else {
      nextEffects[key] = value;
    }
    store.update((current) => updateClip(current, clip.id, { effects: nextEffects }));
  }

  function setRelight(
    patch: Partial<NonNullable<ClipEffects['relight']>>,
  ): void {
    const current = effects.relight;
    setEffect('relight', {
      x: patch.x ?? current?.x ?? 0,
      y: patch.y ?? current?.y ?? 0,
      radius: patch.radius ?? current?.radius ?? 0.45,
      strength: patch.strength ?? current?.strength ?? 0.35,
      warmth: patch.warmth ?? current?.warmth ?? 0.08,
      ...(patch.feather !== undefined
        ? { feather: patch.feather }
        : current?.feather !== undefined
          ? { feather: current.feather }
          : {}),
    });
  }

  async function detectRelight(): Promise<void> {
    if (!asset || asset.kind !== 'video' || !windowedSource || relightBusy) return;
    const media = asset.media;
    if (!media) {
      setRelightError('El video no tiene duración medida para analizar rostros.');
      return;
    }
    const fps = media.frameRate.num / media.frameRate.den;
    if (!(fps > 0)) {
      setRelightError('El video no tiene una tasa de frames válida.');
      return;
    }
    setRelightBusy(true);
    setRelightError(null);
    try {
      const track = await store.service.analyzeFaceTrack({
        path: asset.source.path,
        startSeconds: windowedSource.inFrame / fps,
        endSeconds: windowedSource.outFrame / fps,
      });
      const samples = track.samples;
      if (samples.length === 0) {
        setRelightError(
          'No se detectó un rostro frontal en el clip; podés centrar el relight a mano.',
        );
        return;
      }
      const count = samples.length;
      const centerX = samples.reduce((sum, sample) => sum + sample.centerX, 0) / count;
      const centerY = samples.reduce((sum, sample) => sum + sample.centerY, 0) / count;
      const size = samples.reduce((sum, sample) => sum + sample.size, 0) / count;
      setRelight({
        x: Math.max(-1, Math.min(1, (centerX - 0.5) * 2)),
        y: Math.max(-1, Math.min(1, (centerY - 0.5) * 2)),
        radius: Math.max(0.18, Math.min(1, size * 2.2)),
      });
      store.setNotice(
        `Relight centrado en el rostro (${track.detections} muestras del clip).`,
      );
    } catch (cause) {
      setRelightError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo detectar el rostro para el relight',
      );
    } finally {
      setRelightBusy(false);
    }
  }

  return (
    <Section title="Relight por rostro" group="video" subtab="ia">
      <p className="fine-print">
        Máscara radial de luz sobre el sujeto. No es un modelo generativo:
        aclara/oscurce y templa la zona elegida en el MP4.
      </p>
      <div className="actions compact">
        <button
          type="button"
          className="small ghost icon-text"
          onClick={() => void detectRelight()}
          disabled={!asset || asset.kind !== 'video' || relightBusy}
        >
          <Icon name="eye" size={14} />
          <span>{relightBusy ? 'Detectando…' : 'Centrar en el rostro'}</span>
        </button>
        {effects.relight ? (
          <button
            type="button"
            className="small ghost"
            onClick={() => setEffect('relight', undefined)}
          >
            Quitar relight
          </button>
        ) : null}
      </div>
      {relightError ? (
        <p className="notice notice-warning" role="alert">
          {relightError}
        </p>
      ) : null}
      <div className="inspector-grid">
        <NumberField
          label="Fuerza"
          value={effects.relight?.strength ?? 0.35}
          min={-1}
          max={1}
          step={0.05}
          onCommit={(value) => setRelight({ strength: value })}
        />
        <NumberField
          label="Calidez"
          value={effects.relight?.warmth ?? 0.08}
          min={-1}
          max={1}
          step={0.05}
          onCommit={(value) => setRelight({ warmth: value })}
        />
        <NumberField
          label="Radio"
          value={effects.relight?.radius ?? 0.45}
          min={0.05}
          max={1}
          step={0.05}
          onCommit={(value) => setRelight({ radius: value })}
        />
        <NumberField
          label="Centro X"
          value={effects.relight?.x ?? 0}
          min={-1}
          max={1}
          step={0.05}
          onCommit={(value) => setRelight({ x: value })}
        />
        <NumberField
          label="Centro Y"
          value={effects.relight?.y ?? 0}
          min={-1}
          max={1}
          step={0.05}
          onCommit={(value) => setRelight({ y: value })}
        />
      </div>
      <p className="fine-print">
        La preview aplica el relight en vivo (aproximación del `geq` aditivo
        del MP4). El cálculo por píxel puede ser lento en 4K.
      </p>
    </Section>
  );
}
