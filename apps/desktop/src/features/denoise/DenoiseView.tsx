import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  DenoiseMode,
  DenoisePreset,
  DenoiseResult,
  DialoguePreset,
  DialogueResult,
  MediaProbe,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { addAsset } from '../../state/project-actions';
import { queuePendingComparison } from '../compare/pending';
import {
  DENOISE_PRESETS,
  clampDenoiseStrength,
  denoiseFilterSummary,
  formatDenoiseBytes,
  formatDenoiseDuration,
} from './denoise';
import { RealtimeDenoisePreview } from './RealtimeDenoisePreview';

/**
 * Denoise Studio: preview en tiempo real con WebGL y render FFmpeg.
 *
 * El preview es una aproximación espacial; el archivo final usa hqdn3d,
 * atadenoise o nlmeans según el preajuste. No se promete tiempo real en 4K:
 * el render de calidad va a FFmpeg y se puede cancelar cerrando la app.
 */
export function DenoiseView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [mode, setMode] = useState<DenoiseMode>('video');
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [preset, setPreset] = useState<DenoisePreset>('balanced');
  const [strength, setStrength] = useState(55);
  const [temporal, setTemporal] = useState(true);
  const [preserveDetail, setPreserveDetail] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [result, setResult] = useState<DenoiseResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [dialoguePreset, setDialoguePreset] = useState<DialoguePreset>('dialogo');
  const [dialogueBusy, setDialogueBusy] = useState(false);
  const [dialogueProgress, setDialogueProgress] = useState<number | null>(null);
  const [dialogueStage, setDialogueStage] = useState('');
  const [dialogueResult, setDialogueResult] = useState<DialogueResult | null>(null);
  const [dialogueError, setDialogueError] = useState<string | null>(null);

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void store.service
      .onDenoiseProgress((event) => setProgress(event.percent))
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      .catch(() => {});
    let dialogueUnsubscribe: (() => void) | null = null;
    void store.service
      .onDialogueProgress((event) => {
        setDialogueProgress(event.percent);
        setDialogueStage(event.stage);
      })
      .then((off) => {
        if (active) dialogueUnsubscribe = off;
        else off();
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
      dialogueUnsubscribe?.();
    };
  }, [store.service]);

  const inputUrl = inputPath ? store.service.absoluteFileUrl(inputPath) : '';
  const safeStrength = clampDenoiseStrength(strength);
  const summary = denoiseFilterSummary(preset, safeStrength, temporal, preserveDetail);

  function reset(): void {
    setResult(null);
    setProgress(null);
    setError(null);
  }

  async function pick(source: DenoiseMode): Promise<void> {
    setBusy(true);
    reset();
    try {
      if (source === 'image') {
        const path = await store.service.chooseImageFile('Elegir la imagen para reducir ruido');
        if (!path) return;
        setMode('image');
        setInputPath(path);
        try {
          setProbe(await store.service.probeMediaFile(path));
        } catch {
          setProbe(null);
        }
      } else {
        const path = await store.service.chooseVideoFile('Elegir el video para reducir ruido');
        if (!path) return;
        setMode('video');
        const media = await store.service.probeMediaFile(path);
        setInputPath(media.path);
        setProbe(media);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo leer el archivo');
      setInputPath(null);
      setProbe(null);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder(): Promise<void> {
    const folder = await store.service.chooseDownloadDirectory();
    if (folder) setOutputDir(folder);
  }

  async function run(): Promise<void> {
    if (!inputPath) return;
    setBusy(true);
    reset();
    setProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setError('Elegí una carpeta de destino para el archivo con denoise.');
          return;
        }
        setOutputDir(destination);
      }
      const rendered = await store.service.denoiseMedia({
        inputPath,
        outputDir: destination,
        mode,
        preset,
        strength: safeStrength,
        temporal,
        preserveDetail,
      });
      setResult(rendered);
      setProgress(null);
      store.setNotice(
        `Denoise listo: ${formatDenoiseBytes(rendered.bytes)} · ${formatDenoiseDuration(rendered.durationSeconds)}.`,
      );
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error ? failure.message : 'el denoise falló');
    } finally {
      setBusy(false);
    }
  }

  function compareImage(): void {
    if (!result || !inputPath) return;
    queuePendingComparison({ beforePath: inputPath, afterPath: result.path });
    onNavigate('compare');
  }

  async function importResult(): Promise<void> {
    if (!result || importBusy) return;
    const project = store.state.project;
    if (!project) {
      store.setNotice('Abrí un proyecto para importar el resultado a Medios.');
      return;
    }
    setImportBusy(true);
    try {
      const outcome = await store.service.importMediaPaths({
        paths: [result.path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'denoise',
      });
      const asset = outcome.assets[0];
      if (!asset) {
        store.setNotice(outcome.warnings[0] ?? 'no se pudo importar el archivo con denoise');
        return;
      }
      store.update((current) => addAsset(current, asset), {
        notice: `${asset.label} se importó a Medios.`,
      });
    } catch (failure) {
      store.setNotice(
        failure instanceof Error ? failure.message : 'no se pudo importar el resultado',
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function pickAudio(): Promise<void> {
    setDialogueBusy(true);
    setDialogueResult(null);
    setDialogueError(null);
    try {
      const path = await store.service.chooseAudioFile(
        'Elegir el audio para mejorar la voz',
      );
      if (path) setAudioPath(path);
    } catch (failure) {
      setDialogueError(
        failure instanceof Error ? failure.message : 'no se pudo abrir el audio',
      );
    } finally {
      setDialogueBusy(false);
    }
  }

  async function runDialogue(): Promise<void> {
    if (!audioPath) return;
    setDialogueBusy(true);
    setDialogueResult(null);
    setDialogueError(null);
    setDialogueProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setDialogueError('Elegí una carpeta de destino para el WAV mejorado.');
          return;
        }
        setOutputDir(destination);
      }
      const rendered = await store.service.enhanceDialogue({
        inputPath: audioPath,
        outputDir: destination,
        preset: dialoguePreset,
      });
      setDialogueResult(rendered);
      store.setNotice(
        `Voz mejorada: ${formatDenoiseBytes(rendered.bytes)} · ${formatDenoiseDuration(rendered.durationSeconds)}.`,
      );
    } catch (failure) {
      setDialogueError(
        failure instanceof Error ? failure.message : 'la mejora de voz falló',
      );
    } finally {
      setDialogueBusy(false);
      setDialogueProgress(null);
      setDialogueStage('');
    }
  }

  return (
    <section className="view compress-view denoise-view">
      <ViewToolbar
        label="Denoise"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Reducir ruido en tiempo real</h2>
          <p>
            Movés la fuerza y ves el resultado en el canvas; cuando te gusta, FFmpeg
            procesa el archivo completo. El preview es espacial y aproximado, el render
            aplica temporal y la calidad del preajuste.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <div className="denoise-source-actions">
        <button
          type="button"
          className={`compress-slot${mode === 'video' && inputPath ? ' loaded' : ''}`}
          onClick={() => void pick('video')}
          disabled={busy}
        >
          <Icon name="film" size={16} />
          <strong>{mode === 'video' && inputPath ? 'Video elegido' : 'Elegir video'}</strong>
          <span>
            {mode === 'video' && inputPath
              ? inputPath.split(/[\\/]/).pop()
              : 'MP4, MOV, MKV, WebM y cualquier formato que FFmpeg lea'}
          </span>
        </button>
        <button
          type="button"
          className={`compress-slot${mode === 'image' && inputPath ? ' loaded' : ''}`}
          onClick={() => void pick('image')}
          disabled={busy}
        >
          <Icon name="assets" size={16} />
          <strong>{mode === 'image' && inputPath ? 'Imagen elegida' : 'Elegir imagen'}</strong>
          <span>
            {mode === 'image' && inputPath
              ? inputPath.split(/[\\/]/).pop()
              : 'JPG, PNG, WebP, TIFF y otros'}
          </span>
        </button>
      </div>

      {probe ? (
        <dl className="compress-info" aria-label="Datos del archivo">
          <div>
            <dt>Resolución</dt>
            <dd>{probe.width && probe.height ? `${probe.width}×${probe.height}` : '—'}</dd>
          </div>
          <div>
            <dt>Duración</dt>
            <dd>{formatDenoiseDuration(probe.durationSeconds)}</dd>
          </div>
          <div>
            <dt>Video</dt>
            <dd>{probe.videoCodec ?? '—'}</dd>
          </div>
          <div>
            <dt>Audio</dt>
            <dd>{probe.audioCodec ?? 'sin audio'}</dd>
          </div>
          <div>
            <dt>Peso original</dt>
            <dd>{formatDenoiseBytes(probe.bytes)}</dd>
          </div>
        </dl>
      ) : null}

      {inputPath && inputUrl ? (
        <>
          <div className="compress-presets" role="group" aria-label="Preajuste de denoise">
            {DENOISE_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`compress-preset${preset === option.id ? ' active' : ''}`}
                aria-pressed={preset === option.id}
                onClick={() => setPreset(option.id)}
                disabled={busy}
              >
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="denoise-controls">
            <label className="field denoise-strength">
              <span>
                Fuerza <output>{safeStrength}%</output>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={safeStrength}
                aria-label="Fuerza de reducción de ruido"
                onChange={(event) => setStrength(clampDenoiseStrength(Number(event.target.value)))}
                disabled={busy}
              />
            </label>
            <div className="denoise-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={temporal}
                  onChange={(event) => setTemporal(event.target.checked)}
                  disabled={busy || preset === 'quality'}
                />
                <span>Temporal (menos parpadeo)</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={preserveDetail}
                  onChange={(event) => setPreserveDetail(event.target.checked)}
                  disabled={busy}
                />
                <span>Preservar detalle</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showOriginal}
                  onChange={(event) => setShowOriginal(event.target.checked)}
                  disabled={busy}
                />
                <span>Ver original</span>
              </label>
            </div>
          </div>

          <div className="denoise-preview-head">
            <div>
              <strong>{mode === 'video' ? 'Preview del video' : 'Preview de la imagen'}</strong>
              <span>{summary}</span>
            </div>
            <span className="denoise-live-badge">
              <span aria-hidden="true" /> WebGL en tiempo real
            </span>
          </div>
          <RealtimeDenoisePreview
            src={inputUrl}
            kind={mode}
            strength={safeStrength}
            enabled={!showOriginal}
          />
          <p className="fine-print">
            El canvas muestra un filtro bilateral aproximado. El render final usa{' '}
            <code>{preset === 'quality' ? 'nlmeans' : 'hqdn3d'}</code>
            {temporal && preset !== 'quality' ? ' + temporal' : ''} sobre el archivo original.
          </p>

          {busy && progress !== null ? (
            <div className="compress-progress" role="status" aria-live="polite">
              <div className="compress-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(progress)}%` }} />
              </div>
              <p className="compress-numbers">{Math.round(progress)} %</p>
            </div>
          ) : null}

          <div className="compress-actions">
            <button type="button" className="primary icon-text" onClick={() => void run()} disabled={busy}>
              <Icon name="sparkles" size={15} />
              <span>{busy ? 'Procesando…' : 'Aplicar y guardar'}</span>
            </button>
            <button type="button" className="ghost" onClick={() => void chooseFolder()} disabled={busy}>
              Carpeta: {outputDir ? outputDir.split(/[\\/]/).pop() : 'elegir…'}
            </button>
          </div>
        </>
      ) : (
        <div className="denoise-empty">
          <Icon name="effects" size={22} />
          <p>Elegí un video o una imagen para empezar. El preview corre localmente.</p>
        </div>
      )}

      {result ? (
        <div className="compress-result" role="status">
          <p className="compress-numbers">
            {formatDenoiseBytes(result.sourceBytes)} →{' '}
            <strong>{formatDenoiseBytes(result.bytes)}</strong>
            {result.durationSeconds ? ` · ${formatDenoiseDuration(result.durationSeconds)}` : ''}
          </p>
          <p className="compress-path">{result.path}</p>
          <p className="fine-print">
            Filtro aplicado: <code>{result.filter}</code>
            {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary icon-text"
              disabled={importBusy || !store.state.project}
              onClick={() => void importResult()}
              title="Copia el resultado a la carpeta media del proyecto y lo agrega a Medios"
            >
              <Icon name="assets" size={15} />
              <span>{importBusy ? 'Importando…' : 'Importar a Medios'}</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void store.service.revealOutput(result.path)}
            >
              <Icon name="folder" size={15} />
              <span>Mostrar en carpeta</span>
            </button>
            {mode === 'image' ? (
              <button type="button" className="ghost icon-text" onClick={compareImage}>
                <Icon name="split" size={15} />
                <span>Comparar antes y después</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card denoise-dialogue">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Voz clara</p>
            <h3>Mejorar diálogo con DSP local</h3>
          </div>
          <span className="fine-print">FilmCraft DSP · MIT/Apache-2.0</span>
        </div>
        <p className="fine-print">
          Denoise espectral, de-hum, de-esser, de-reverb, EQ, compresor,
          realce de voz y limitador de pico real. No separa voces superpuestas ni
          usa un modelo de IA; procesa hasta 180 s y guarda WAV PCM 24 bits.
        </p>
        <div className="denoise-source-actions">
          <button
            type="button"
            className={`compress-slot${audioPath ? ' loaded' : ''}`}
            onClick={() => void pickAudio()}
            disabled={dialogueBusy}
          >
            <Icon name="audio" size={16} />
            <strong>{audioPath ? 'Audio elegido' : 'Elegir audio'}</strong>
            <span>
              {audioPath
                ? audioPath.split(/[\/]/).pop()
                : 'WAV, MP3, M4A, FLAC, OGG o el audio de un video'}
            </span>
          </button>
          <label className="field">
            <span>Cadena</span>
            <select
              value={dialoguePreset}
              onChange={(event) =>
                setDialoguePreset(event.target.value as DialoguePreset)
              }
              disabled={dialogueBusy}
            >
              <option value="dialogo">Diálogo completo</option>
              <option value="voz">Voz clara</option>
              <option value="podcast">Podcast (con de-reverb)</option>
              <option value="suave">Suave</option>
            </select>
          </label>
        </div>
        {dialogueError ? (
          <p className="notice notice-warning" role="alert">
            {dialogueError}
          </p>
        ) : null}
        {dialogueBusy && dialogueProgress !== null ? (
          <div className="compress-progress" role="status" aria-live="polite">
            <div className="compress-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(dialogueProgress)}%` }} />
            </div>
            <p className="compress-numbers">
              {Math.round(dialogueProgress)} %{dialogueStage ? ` · ${dialogueStage}` : ''}
            </p>
          </div>
        ) : null}
        <div className="compress-actions">
          <button
            type="button"
            className="primary icon-text"
            onClick={() => void runDialogue()}
            disabled={dialogueBusy || !audioPath}
          >
            <Icon name="sparkles" size={15} />
            <span>{dialogueBusy ? 'Mejorando…' : 'Mejorar voz y guardar WAV'}</span>
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void chooseFolder()}
            disabled={dialogueBusy}
          >
            Carpeta: {outputDir ? outputDir.split(/[\/]/).pop() : 'elegir…'}
          </button>
        </div>
        {dialogueResult ? (
          <div className="compress-result" role="status">
            <p className="compress-numbers">
              WAV <strong>{formatDenoiseBytes(dialogueResult.bytes)}</strong> ·{' '}
              {formatDenoiseDuration(dialogueResult.durationSeconds)}
            </p>
            <p className="compress-path">{dialogueResult.path}</p>
            <p className="fine-print">
              Cadena: <code>{dialogueResult.effects.join(' → ')}</code>
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary icon-text"
                onClick={() => void store.service.revealOutput(dialogueResult.path)}
              >
                <Icon name="folder" size={15} />
                <span>Mostrar en carpeta</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
