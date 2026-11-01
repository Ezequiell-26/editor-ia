import { useEffect, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { addAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  THREE_PRESETS,
  presetById,
  type ThreePresetId,
} from '../three/scene';
import type { Scene3DVideoResult } from '../three/bake';

/**
 * Escena 3D on-demand: Three.js renderiza frames deterministas y se hornea un
 * MP4 VP9 que entra a Medios. El proyecto sigue usando el preview/export normal.
 */
export function ThreeScenePanel({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [presetId, setPresetId] = useState<ThreePresetId>('orbit-cube');
  const [seconds, setSeconds] = useState(4);
  const [quality, setQuality] = useState<'720' | '1080'>('720');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<Scene3DVideoResult | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaLabel, setMediaLabel] = useState<string | null>(null);
  const preset = presetById(presetId);

  useEffect(
    () => () => {
      if (video?.url) URL.revokeObjectURL(video.url);
    },
    [video],
  );

  async function previewFrame(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { createThreeScene } = await import('../three/scene');
      const scene = await createThreeScene({ preset: presetId, width: 640, height: 360 });
      try {
        const frame = scene.renderAt(0.35);
        const canvas = previewRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) throw new Error('No se pudo preparar el canvas de preview.');
        canvas.width = 640;
        canvas.height = 360;
        context.drawImage(frame, 0, 0, 640, 360);
      } finally {
        scene.dispose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo previsualizar la escena 3D.');
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setProgress(0);
    setMediaLabel(null);
    if (video?.url) URL.revokeObjectURL(video.url);
    setVideo(null);
    try {
      const { renderScene3DToVideo } = await import('../three/bake');
      const result = await renderScene3DToVideo({
        preset: presetId,
        width: quality === '1080' ? 1920 : 1280,
        height: quality === '1080' ? 1080 : 720,
        fps: 24,
        durationSeconds: seconds,
        onProgress: setProgress,
      });
      setVideo(result);
      setProgress(1);
      store.setNotice(`Escena 3D ${preset.label} generada (${result.durationSeconds} s).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar la escena 3D.');
    } finally {
      setBusy(false);
    }
  }

  async function sendToMedia(): Promise<void> {
    if (!video) return;
    if (!project) {
      setError('Abrí un proyecto para enviar la escena a Medios.');
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
        provider: 'olyvia-three',
      });
      const imported = outcome.assets[0];
      if (!imported) {
        setError(outcome.warnings[0] ?? 'No se pudo importar la escena 3D a Medios.');
        return;
      }
      const ok = store.update(
        (current) => addAsset(current, imported),
        { notice: `Escena 3D agregada a Medios: ${imported.label}.` },
      );
      if (!ok) {
        setError(store.state.error ?? 'No se pudo agregar la escena al proyecto.');
        return;
      }
      setMediaLabel(imported.label);
      onNavigate('editor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la escena a Medios.');
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <div className="card motion-ai" aria-label="Escena 3D">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">3D</p>
          <h3>Escena 3D</h3>
        </div>
        <span className="fine-print">Three.js on-demand · MP4 VP9</span>
      </div>
      <div className="inspector-grid">
        <label className="field">
          <span>Escena</span>
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value as ThreePresetId)}
          >
            {THREE_PRESETS.map((item) => (
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
      </div>
      <p className="fine-print">{preset.description} Se hornea a Medios; no agrega un segundo renderizador.</p>
      <div className="actions compact">
        <button type="button" className="ghost" disabled={busy} onClick={() => void previewFrame()}>
          Previsualizar
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void generate()}>
          {busy ? `Generando… ${Math.round(progress * 100)}%` : 'Generar video 3D'}
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
        aria-label="Previsualización de la escena 3D"
        style={{ width: '100%', maxWidth: 640, borderRadius: 10, background: preset.background }}
      />
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
