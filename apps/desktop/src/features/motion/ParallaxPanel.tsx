import { useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { fpsOf } from '../../state/project-actions';
import {
  PARALLAX_PRESETS,
  addParallaxScene,
  type ParallaxDirection,
  type ParallaxPreset,
} from '../../state/parallax';
import { useProjectStore } from '../../state/project-store';

/**
 * Panel 2.5D: fondo + recorte con presets de parallax. El recorte debe ser una
 * imagen/video con alfa aportado por el usuario; no se inventa segmentación.
 */
export function ParallaxPanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const assets = useMemo(
    () =>
      project?.assets.filter(
        (asset) =>
          asset.status === 'ready' && (asset.kind === 'image' || asset.kind === 'video'),
      ) ?? [],
    [project],
  );
  const [backgroundId, setBackgroundId] = useState('');
  const [foregroundId, setForegroundId] = useState('');
  const [presetId, setPresetId] = useState<ParallaxPreset>('parallax-soft');
  const [direction, setDirection] = useState<ParallaxDirection>('left');
  const [intensity, setIntensity] = useState(0.12);
  const [seconds, setSeconds] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = PARALLAX_PRESETS.find((item) => item.id === presetId) ?? PARALLAX_PRESETS[0]!;
  const background = backgroundId || assets[0]?.id || '';
  const foreground = foregroundId || (assets.length > 1 ? assets[1]!.id : '');
  const canCreate =
    Boolean(project) &&
    assets.length > 0 &&
    Boolean(background) &&
    (!preset.requiresForeground || Boolean(foreground)) &&
    !busy;

  function create(): void {
    if (!project || !canCreate) return;
    setBusy(true);
    setError(null);
    const created: { value: ReturnType<typeof addParallaxScene> | null } = { value: null };
    const ok = store.mutate((current) => {
      const result = addParallaxScene(current, {
        backgroundAssetId: background,
        ...(foreground ? { foregroundAssetId: foreground } : {}),
        preset: presetId,
        direction,
        intensity,
        durationFrames: Math.max(1, Math.round(seconds * fpsOf(current))),
      });
      created.value = result;
      return { project: result.project };
    });
    setBusy(false);
    if (!ok || !created.value) {
      setError('La composición no deja el proyecto en un estado válido.');
      return;
    }
    const clipId = created.value.foregroundClipId ?? created.value.backgroundClipId;
    store.setSelection({ kind: 'clip', id: clipId });
    store.setNotice(`Parallax ${preset.label} agregado a la timeline.`);
    onNavigate('editor');
  }

  return (
    <div className="card motion-ai" aria-label="Parallax 2.5D">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">2.5D</p>
          <h3>Parallax y profundidad</h3>
        </div>
        <span className="fine-print">
          {preset.requiresForeground ? 'Fondo + recorte' : 'Una capa'} · {preset.label}
        </span>
      </div>
      {assets.length === 0 ? (
        <p className="fine-print">
          Importá al menos una imagen o video en Medios para crear una composición.
        </p>
      ) : (
        <>
          <div className="inspector-grid">
            <label className="field">
              <span>Fondo</span>
              <select value={background} onChange={(event) => setBackgroundId(event.target.value)}>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Primer plano (recorte con alfa)</span>
              <select
                value={foreground}
                onChange={(event) => setForegroundId(event.target.value)}
              >
                <option value="">Sin recorte</option>
                {assets
                  .filter((asset) => asset.id !== background)
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Preset</span>
              <select
                value={presetId}
                onChange={(event) => setPresetId(event.target.value as ParallaxPreset)}
              >
                {PARALLAX_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Dirección</span>
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value as ParallaxDirection)}
              >
                <option value="left">Izquierda</option>
                <option value="right">Derecha</option>
                <option value="up">Arriba</option>
                <option value="down">Abajo</option>
              </select>
            </label>
            <label className="field">
              <span>Intensidad</span>
              <input
                type="range"
                min={0.02}
                max={0.5}
                step={0.01}
                value={intensity}
                aria-label="Intensidad del parallax"
                onChange={(event) => setIntensity(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Duración (segundos)</span>
              <input
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={seconds}
                onChange={(event) =>
                  setSeconds(Math.min(30, Math.max(1, Number(event.target.value) || 1)))
                }
              />
            </label>
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="primary"
              disabled={!canCreate}
              onClick={create}
            >
              {busy ? 'Creando…' : 'Crear composición'}
            </button>
            <span className="fine-print">
              {preset.requiresForeground && !foreground
                ? 'Este preset necesita un recorte de primer plano.'
                : 'El recorte debe traer su alfa; no hay segmentación automática.'}
            </span>
          </div>
          {error ? (
            <p className="notice notice-warning" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
