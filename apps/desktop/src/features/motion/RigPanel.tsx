import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { addAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  RIG_CLIPS,
  RIG_PALETTES,
  drawRigFrame,
  rigClipById,
  rigPaletteById,
  type RigClipId,
} from '../rig/rig';
import type { RigVideoResult } from '../rig/bake';

/**
 * Personaje 2D: esqueleto procedural dibujado en canvas y horneado a MP4 VP9.
 * El clip entra a Medios; no se agrega un segundo motor al timeline.
 */
export function RigPanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [clipId, setClipId] = useState<RigClipId>('walk');
  const [paletteId, setPaletteId] = useState('cyan');
  const [seconds, setSeconds] = useState(2);
  const [targetX, setTargetX] = useState(0.82);
  const [targetY, setTargetY] = useState(0.28);
  const [quality, setQuality] = useState<'720' | '1080'>('720');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<RigVideoResult | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaLabel, setMediaLabel] = useState<string | null>(null);
  const clip = rigClipById(clipId);
  const palette = rigPaletteById(paletteId);
  const ikTarget = clipId === 'reach' ? { x: targetX, y: targetY } : undefined;

  function paintTarget(context: CanvasRenderingContext2D, width: number, height: number): void {
    if (!ikTarget) return;
    const x = ikTarget.x * width;
    const y = ikTarget.y * height;
    context.save();
    context.strokeStyle = palette.palette.accent;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.moveTo(x - 14, y);
    context.lineTo(x + 14, y);
    context.moveTo(x, y - 14);
    context.lineTo(x, y + 14);
    context.stroke();
    context.restore();
  }

  useEffect(() => {
    const canvas = previewRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    drawRigFrame(
      context,
      canvas.width,
      canvas.height,
      clipId,
      0.35,
      palette.palette,
      ikTarget ? { target: ikTarget } : {},
    );
    paintTarget(context, canvas.width, canvas.height);
  }, [clipId, paletteId, palette.palette, targetX, targetY]);

  useEffect(
    () => () => {
      if (video?.url) URL.revokeObjectURL(video.url);
    },
    [video],
  );

  function previewFrame(): void {
    const canvas = previewRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      setError('No se pudo preparar el canvas de preview.');
      return;
    }
    setError(null);
    drawRigFrame(
      context,
      canvas.width,
      canvas.height,
      clipId,
      0.35,
      palette.palette,
      ikTarget ? { target: ikTarget } : {},
    );
    paintTarget(context, canvas.width, canvas.height);
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setProgress(0);
    setMediaLabel(null);
    if (video?.url) URL.revokeObjectURL(video.url);
    setVideo(null);
    try {
      const { renderRigToVideo } = await import('../rig/bake');
      const result = await renderRigToVideo({
        clip: clipId,
        paletteId,
        width: quality === '1080' ? 1920 : 1280,
        height: quality === '1080' ? 1080 : 720,
        fps: 24,
        durationSeconds: seconds,
        ...(ikTarget ? { target: ikTarget } : {}),
        onProgress: setProgress,
      });
      setVideo(result);
      setProgress(1);
      store.setNotice(`Personaje 2D ${clip.label} generado (${result.durationSeconds} s).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el personaje 2D.');
    } finally {
      setBusy(false);
    }
  }

  async function sendToMedia(): Promise<void> {
    if (!video) return;
    if (!project) {
      setError('Abrí un proyecto para enviar el personaje a Medios.');
      return;
    }
    setMediaBusy(true);
    setError(null);
    try {
      const path = await store.service.stageDesignMedia(video.base64, 'mp4');
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-rig',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setError(outcome.warnings[0] ?? 'No se pudo importar el personaje a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `Personaje 2D agregado a Medios: ${imported.label}.` },
      );
      if (!ok) {
        setError(store.state.error ?? 'No se pudo agregar el personaje al proyecto.');
        return;
      }
      setMediaLabel(imported.label);
      onNavigate('editor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el personaje a Medios.');
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <div className="card motion-ai" aria-label="Rig 2D">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Rig 2D</p>
          <h3>Personaje 2D</h3>
        </div>
        <span className="fine-print">Esqueleto procedural · MP4 VP9</span>
      </div>
      <div className="inspector-grid">
        <label className="field">
          <span>Animación</span>
          <select
            value={clipId}
            onChange={(event) => setClipId(event.target.value as RigClipId)}
          >
            {RIG_CLIPS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Paleta</span>
          <select value={paletteId} onChange={(event) => setPaletteId(event.target.value)}>
            {RIG_PALETTES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Duración (segundos)</span>
          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            value={seconds}
            onChange={(event) =>
              setSeconds(Math.min(10, Math.max(1, Number(event.target.value) || 1)))
            }
          />
        </label>
        <label className="field">
          <span>Calidad</span>
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value as '720' | '1080')}
          >
            <option value="720">720p · 24 fps</option>
            <option value="1080">1080p · 24 fps</option>
          </select>
        </label>
        {clipId === 'reach' ? (
          <>
            <label className="field">
              <span>Objetivo X {targetX.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={targetX}
                onChange={(event) => setTargetX(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Objetivo Y {targetY.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={targetY}
                onChange={(event) => setTargetY(Number(event.target.value))}
              />
            </label>
          </>
        ) : null}
      </div>
      <p className="fine-print">
        {clip.label}: {clip.description} Ciclo sugerido de {clip.cycleSeconds} s. Se hornea a
        Medios; no agrega un segundo renderizador.
      </p>
      <div className="actions compact">
        <button type="button" className="ghost" disabled={busy} onClick={previewFrame}>
          Previsualizar
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void generate()}>
          {busy ? `Generando… ${Math.round(progress * 100)}%` : 'Generar video 2D'}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!video || mediaBusy}
          onClick={() => void sendToMedia()}
        >
          {mediaBusy ? 'Enviando…' : 'Enviar a Medios'}
        </button>
        {mediaLabel ? <span className="fine-print">En Medios: {mediaLabel}</span> : null}
      </div>
      <canvas
        ref={previewRef}
        width={640}
        height={360}
        aria-label="Previsualización del personaje 2D"
        style={{ width: '100%', maxWidth: 640, borderRadius: 10, background: palette.palette.background }}
      />
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
