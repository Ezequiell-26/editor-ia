import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { UpscaleResult, UpscaleVideoResult } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { queuePendingComparison } from '../compare/pending';
import { LocalModelGate, useLocalModel } from './LocalModelGate';

/**
 * Upscale ×4 con Real-ESRGAN local.
 *
 * Fase 3: segundo consumo del gestor de modelos. El modelo tiene entrada fija
 * de 128×128, así que la imagen se procesa por teselas con solape; el límite
 * de 2048 por lado es de memoria y está explicado en la UI. La vista comprueba
 * el modelo antes de ejecutar y ofrece descargarlo acá mismo.
 */
export function UpscaleView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [result, setResult] = useState<UpscaleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<UpscaleVideoResult | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [videoFrames, setVideoFrames] = useState<{ frame: number; total: number } | null>(null);
  const [maxSeconds, setMaxSeconds] = useState('');
  const model = useLocalModel(store.service, 'upscale');

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void store.service
      .onUpscaleProgress((event) => {
        setVideoProgress(event.percent);
        if (event.frame !== undefined && event.total !== undefined) {
          setVideoFrames({ frame: event.frame, total: event.total });
        }
      })
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [store.service]);

  async function pickImage(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await store.service.chooseImageFile('Elegir la imagen a agrandar');
      if (path) setInputPath(path);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo abrir la imagen');
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (!inputPath) return;
    if (model.state !== 'ready') {
      setError('Falta el modelo local de upscale: descargalo en el panel «Modelo local» de esta vista.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await store.service.upscaleImage(inputPath));
      store.setNotice('Upscale ×4 listo. El resultado quedó listo para comparar.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'el upscale falló');
    } finally {
      setBusy(false);
    }
  }

  async function pickVideo(): Promise<void> {
    setVideoBusy(true);
    setError(null);
    setVideoResult(null);
    try {
      const path = await store.service.chooseVideoFile('Elegir el video a agrandar');
      if (path) setVideoPath(path);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo abrir el video');
    } finally {
      setVideoBusy(false);
    }
  }

  async function runVideo(): Promise<void> {
    if (!videoPath) return;
    if (model.state !== 'ready') {
      setError('Falta el modelo local de upscale: descargalo en el panel «Modelo local» de esta vista.');
      return;
    }
    const cap = Number(maxSeconds);
    setVideoBusy(true);
    setError(null);
    setVideoResult(null);
    setVideoProgress(0);
    setVideoFrames(null);
    try {
      const rendered = await store.service.upscaleVideo(
        videoPath,
        undefined,
        Number.isFinite(cap) && cap > 0 ? cap : undefined,
      );
      setVideoResult(rendered);
      store.setNotice('Upscale de video ×4 listo. El MP4 quedó junto al original.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'el upscale de video falló');
    } finally {
      setVideoBusy(false);
      setVideoProgress(null);
      setVideoFrames(null);
    }
  }

  function compare(): void {
    if (!result || !inputPath) return;
    queuePendingComparison({ beforePath: inputPath, afterPath: result.path });
    onNavigate('compare');
  }

  return (
    <section className="view background-view">
      <ViewToolbar
        label="Upscale"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="background-head">
        <div>
          <h2>Agrandar ×4 con IA local</h2>
          <p>
            Real-ESRGAN corriendo en tu máquina recupera detalle al agrandar ×4. La imagen se
            procesa por teselas de 128×128 con solape, así que puede tardar un rato según el
            tamaño. El modelo exige un límite de 2048×2048 por memoria.
          </p>
        </div>
      </header>

      <LocalModelGate
        label="Real-ESRGAN ×4"
        controller={model}
        onOpenSettings={() => onNavigate('settings')}
      />

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={`compress-slot${inputPath ? ' loaded' : ''}`}
        onClick={() => void pickImage()}
        disabled={busy}
      >
        <Icon name="assets" size={16} />
        <strong>{inputPath ? 'Imagen elegida' : 'Elegir imagen'}</strong>
        <span>
          {inputPath ? inputPath.split(/[\\/]/).pop() : 'hasta 2048×2048; el resultado es ×4'}
        </span>
      </button>

      <div className="background-actions">
        <button
          type="button"
          className="primary icon-text"
          onClick={() => void run()}
          disabled={busy || !inputPath || model.state !== 'ready'}
          title={
            model.state === 'ready'
              ? undefined
              : 'El modelo local no está listo: descargalo o revisá Ajustes → Capacidades'
          }
        >
          <Icon name="sparkles" size={15} />
          <span>{busy ? 'Agrandando…' : 'Agrandar ×4'}</span>
        </button>
      </div>

      {result ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            {result.inputWidth}×{result.inputHeight} →{' '}
            <strong>
              {result.outputWidth}×{result.outputHeight}
            </strong>{' '}
            · {result.tiles} tesela(s)
          </p>
          <p className="compress-path">{result.path}</p>
          <button type="button" className="primary icon-text" onClick={compare}>
            <Icon name="split" size={15} />
            <span>Comparar antes y después</span>
          </button>
        </div>
      ) : null}

      <header className="background-head">
        <div>
          <h2>Video ×4 con IA local</h2>
          <p>
            El mismo Real-ESRGAN procesa cada frame del video y lo re-codifica a H.264 con el
            audio original. Acepta hasta 1280×720 y ~75 s de metraje: en CPU esto tarda
            minutos por segundo de video, así que usá «máx. segundos» para probar primero.
          </p>
        </div>
      </header>

      <button
        type="button"
        className={`compress-slot${videoPath ? ' loaded' : ''}`}
        onClick={() => void pickVideo()}
        disabled={videoBusy}
      >
        <Icon name="assets" size={16} />
        <strong>{videoPath ? 'Video elegido' : 'Elegir video'}</strong>
        <span>
          {videoPath
            ? videoPath.split(/[\\/]/).pop()
            : 'hasta 1280×720 y ~75 s; el resultado es ×4 (ej. 720p → 2880p)'}
        </span>
      </button>

      <div className="denoise-controls">
        <label className="field">
          <span>Máx. segundos (opcional)</span>
          <input
            type="number"
            min={1}
            max={3600}
            placeholder="video completo"
            value={maxSeconds}
            onChange={(e) => setMaxSeconds(e.target.value)}
          />
        </label>
      </div>

      <div className="background-actions">
        <button
          type="button"
          className="primary icon-text"
          onClick={() => void runVideo()}
          disabled={videoBusy || !videoPath || model.state !== 'ready'}
          title={
            model.state === 'ready'
              ? undefined
              : 'El modelo local no está listo: descargalo o revisá Ajustes → Capacidades'
          }
        >
          <Icon name="sparkles" size={15} />
          <span>{videoBusy ? 'Agrandando video…' : 'Agrandar video ×4'}</span>
        </button>
      </div>

      {videoBusy && videoProgress !== null ? (
        <div className="compress-progress" role="status" aria-live="polite">
          <div className="compress-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(videoProgress)}%` }} />
          </div>
          <p className="compress-numbers">
            {Math.round(videoProgress)} %
            {videoFrames ? ` · frame ${videoFrames.frame}/${videoFrames.total}` : ''}
          </p>
        </div>
      ) : null}

      {videoResult ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            {videoResult.inputWidth}×{videoResult.inputHeight} →{' '}
            <strong>
              {videoResult.outputWidth}×{videoResult.outputHeight}
            </strong>{' '}
            · {videoResult.frames} frames ·{' '}
            {videoResult.fpsNum}/{videoResult.fpsDen} fps
          </p>
          <p className="compress-path">{videoResult.path}</p>
          <button
            type="button"
            className="ghost icon-text"
            onClick={() => void store.service.revealOutput(videoResult.path)}
          >
            <Icon name="folder" size={15} />
            <span>Abrir carpeta</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
