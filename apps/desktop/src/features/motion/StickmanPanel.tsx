import { useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import type { StickmanRenderResult } from '../../services/project-service';

const ACTIONS = ['idle', 'walk', 'run', 'wave', 'jump'] as const;
const PARTICLES = ['none', 'confetti', 'snow', 'sparks'] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo renderizar el stickman';
}

function joinPath(dir: string, file: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${file}`;
}

/**
 * Personaje 2D riggeado: renderiza el motor Rust `stickman_render`
 * (rig FK de 14 huesos, acciones procedurales, keyframes y partículas)
 * a un MP4 real verificado con ffprobe.
 */
export function StickmanPanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const service = store.service;
  const [action, setAction] = useState<(typeof ACTIONS)[number]>('walk');
  const [duration, setDuration] = useState(4);
  const [fps, setFps] = useState(24);
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);
  const [boneHex, setBoneHex] = useState('#f8fafc');
  const [bgHex, setBgHex] = useState('#0f172a');
  const [particles, setParticles] = useState<(typeof PARTICLES)[number]>('none');
  const [particleColor, setParticleColor] = useState('#facc15');
  const [particleCount, setParticleCount] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StickmanRenderResult | null>(null);

  async function render(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const dir = await service.chooseDownloadDirectory();
      if (!dir) {
        setError('Elegí una carpeta de destino para el video.');
        return;
      }
      const outputPath = joinPath(dir, `stickman-${action}-${Date.now()}.mp4`);
      const rendered = await service.stickmanRender({
        outputPath,
        action,
        durationSeconds: duration,
        fps,
        width,
        height,
        boneHex,
        bgHex,
        ...(particles !== 'none'
          ? { particles: { kind: particles, count: particleCount, colorHex: particleColor } }
          : {}),
      });
      setResult(rendered);
      if (!rendered.ok) setError('El render no se verificó; revisá los datos del equipo.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card motion-stickman">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Personaje 2D</p>
          <h3>Stickman riggeado</h3>
        </div>
        <span className="fine-print">
          <Icon name="motion" size={13} /> Motor Rust · huesos + keyframes + partículas
        </span>
      </div>
      <p className="fine-print">
        Renderiza un personaje de stickman con rig de 14 huesos a un MP4 real. Elegí la acción,
        la duración y los colores; las partículas son opcionales.
      </p>

      <div className="denoise-controls">
        <label className="field">
          <span>Acción</span>
          <select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            {ACTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Duración (s)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={duration}
            onChange={(e) => setDuration(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="field">
          <span>FPS</span>
          <input
            type="number"
            min={12}
            max={60}
            value={fps}
            onChange={(e) => setFps(Math.min(60, Math.max(12, Number(e.target.value) || 24)))}
          />
        </label>
        <label className="field">
          <span>Tamaño</span>
          <span className="record-inline">
            <input
              type="number"
              min={160}
              max={3840}
              value={width}
              onChange={(e) => setWidth(Math.max(160, Number(e.target.value) || 640))}
            />
            <input
              type="number"
              min={90}
              max={2160}
              value={height}
              onChange={(e) => setHeight(Math.max(90, Number(e.target.value) || 360))}
            />
          </span>
        </label>
        <label className="field">
          <span>Color del personaje</span>
          <input type="color" value={boneHex} onChange={(e) => setBoneHex(e.target.value)} />
        </label>
        <label className="field">
          <span>Fondo</span>
          <input type="color" value={bgHex} onChange={(e) => setBgHex(e.target.value)} />
        </label>
        <label className="field">
          <span>Partículas</span>
          <select
            value={particles}
            onChange={(e) => setParticles(e.target.value as typeof particles)}
          >
            {PARTICLES.map((item) => (
              <option key={item} value={item}>
                {item === 'none' ? 'Ninguna' : item}
              </option>
            ))}
          </select>
        </label>
        {particles !== 'none' ? (
          <>
            <label className="field">
              <span>Cantidad</span>
              <input
                type="number"
                min={1}
                max={2000}
                value={particleCount}
                onChange={(e) =>
                  setParticleCount(Math.min(2000, Math.max(1, Number(e.target.value) || 1)))
                }
              />
            </label>
            <label className="field">
              <span>Color partículas</span>
              <input
                type="color"
                value={particleColor}
                onChange={(e) => setParticleColor(e.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="actions compact">
        <button
          type="button"
          className="primary icon-text"
          onClick={() => void render()}
          disabled={busy || !service.available}
        >
          <Icon name="play" size={14} />
          {busy ? 'Renderizando…' : 'Renderizar stickman'}
        </button>
        {result?.ok && result.path ? (
          <button
            type="button"
            className="ghost"
            onClick={() => void service.revealOutput(result.path!)}
          >
            Abrir carpeta
          </button>
        ) : null}
      </div>

      {result?.ok ? (
        <p className="fine-print">
          Listo: {result.frames ?? '?'} frames · {result.fps ?? fps} fps ·{' '}
          {result.probeWidth ?? width}×{result.probeHeight ?? height}
          {result.verified ? ' · verificado con ffprobe' : ''}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="ghost fine-print" onClick={() => onNavigate('learn')}>
        Ver tutorial
      </button>
    </div>
  );
}
