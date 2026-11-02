import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  MediaProbe,
  SharpenMode,
  SharpenResult,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { addAsset } from '../../state/project-actions';
import { queuePendingComparison } from '../compare/pending';
import { RealtimeClarityPreview } from './RealtimeClarityPreview';
import {
  CLARITY_ENCODER_NOTE,
  CLARITY_PRESETS,
  CLARITY_STAGES,
  DEFAULT_CLARITY,
  TARGET_HEIGHTS,
  activeStages,
  clarityFilterSummary,
  claritySummary,
  clampClarity,
  formatSharpenBytes,
  formatSharpenDuration,
  presetForSettings,
  settingsForPreset,
  type ClarityPresetId,
  type ClaritySettings,
  type ClarityStageId,
} from './sharpen';

/**
 * Definición: las cinco técnicas que hacen que un 1080p se vea caro.
 *
 * La vista no promete el render en tiempo real: el canvas muestra una
 * aproximación WebGL de la limpieza, el enfoque, la curva y el grano; el
 * archivo final lo procesa FFmpeg con la cadena que se muestra debajo.
 */
export function SharpenView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [mode, setMode] = useState<SharpenMode>('video');
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [settings, setSettings] = useState<ClaritySettings>(DEFAULT_CLARITY);
  const [showOriginal, setShowOriginal] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [result, setResult] = useState<SharpenResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void store.service
      .onSharpenProgress((event) => setProgress(event.percent))
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

  const inputUrl = inputPath ? store.service.absoluteFileUrl(inputPath) : '';
  const clean = useMemo(() => clampClarity(settings), [settings]);
  const sourceHeight = probe?.height ?? 0;
  const stages = activeStages(clean, sourceHeight);
  const preset = presetForSettings(clean);
  const chain = clarityFilterSummary(clean, sourceHeight);

  function patch(next: Partial<ClaritySettings>): void {
    setSettings((current) => clampClarity({ ...current, ...next }));
  }

  function applyPreset(id: ClarityPresetId): void {
    const next = settingsForPreset(id);
    if (next) setSettings(next);
  }

  function reset(): void {
    setResult(null);
    setProgress(null);
    setError(null);
  }

  async function pick(source: SharpenMode): Promise<void> {
    setBusy(true);
    reset();
    try {
      if (source === 'image') {
        const path = await store.service.chooseImageFile('Elegir la imagen para definir');
        if (!path) return;
        setMode('image');
        setInputPath(path);
        try {
          setProbe(await store.service.probeMediaFile(path));
        } catch {
          setProbe(null);
        }
      } else {
        const path = await store.service.chooseVideoFile('Elegir el video para definir');
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
    if (!inputPath || stages.length === 0) return;
    setBusy(true);
    reset();
    setProgress(0);
    try {
      let destination = outputDir;
      if (!destination) {
        destination = await store.service.chooseDownloadDirectory();
        if (!destination) {
          setError('Elegí una carpeta de destino para el archivo con definición.');
          return;
        }
        setOutputDir(destination);
      }
      const rendered = await store.service.sharpenMedia({
        inputPath,
        outputDir: destination,
        mode,
        denoise: clean.denoise,
        deblock: clean.deblock,
        targetHeight: clean.targetHeight,
        highPrecision: clean.highPrecision,
        unsharpAmount: clean.unsharpAmount,
        unsharpSize: clean.unsharpSize,
        curve: clean.curve,
        grain: clean.grain,
        preset: preset === 'custom' ? null : preset,
      });
      setResult(rendered);
      setProgress(null);
      const size = `${formatSharpenBytes(rendered.sourceBytes)} → ${formatSharpenBytes(rendered.bytes)}`;
      const dimensions =
        rendered.width && rendered.height ? ` · ${rendered.width}×${rendered.height}` : '';
      store.setNotice(`Definición lista: ${size}${dimensions}.`);
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error ? failure.message : 'la definición falló');
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
        provider: 'sharpen',
      });
      const asset = outcome.assets[0];
      if (!asset) {
        store.setNotice(outcome.warnings[0] ?? 'no se pudo importar el archivo con definición');
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

  const stageOn = (id: ClarityStageId): boolean => stages.includes(id);

  return (
    <section className="view compress-view denoise-view clarity-view">
      <ViewToolbar
        label="Definición"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Nitidez perceptual, no más píxeles</h2>
          <p>
            Cinco etapas encadenadas en el orden del oficio: primero se limpia el
            artefacto de compresión, después se escala, recién entonces se enfoca,
            se aplica la curva de micro-contraste y el grano queda al final.
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
            <dd>{formatSharpenDuration(probe.durationSeconds)}</dd>
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
            <dd>{formatSharpenBytes(probe.bytes)}</dd>
          </div>
        </dl>
      ) : null}

      {inputPath && inputUrl ? (
        <>
          <div className="compress-presets" role="group" aria-label="Preajuste de definición">
            {CLARITY_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`compress-preset${preset === option.id ? ' active' : ''}`}
                aria-pressed={preset === option.id}
                onClick={() => applyPreset(option.id)}
                disabled={busy || option.id === 'custom'}
              >
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="clarity-stages">
            {CLARITY_STAGES.map((stage) => {
              const on = stageOn(stage.id);
              return (
                <article
                  key={stage.id}
                  className={`clarity-stage${on ? ' active' : ''}`}
                  aria-label={stage.title}
                >
                  <div className="clarity-stage-head">
                    <div>
                      <h3>{stage.title}</h3>
                      <p className="fine-print">{stage.how}</p>
                    </div>
                    <span className={`clarity-pill${on ? ' on' : ''}`}>
                      {on ? 'Activa' : 'Apagada'}
                    </span>
                  </div>

                  <div className="clarity-stage-body">
                    {stage.id === 'clean' ? (
                      <>
                        <label className="field denoise-strength">
                          <span>
                            Fuerza <output>{clean.denoise}%</output>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={clean.denoise}
                            aria-label="Fuerza de limpieza"
                            onChange={(event) => patch({ denoise: Number(event.target.value) })}
                            disabled={busy}
                          />
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={clean.deblock}
                            onChange={(event) => patch({ deblock: event.target.checked })}
                            disabled={busy}
                          />
                          <span>De-blocking de compresión</span>
                        </label>
                      </>
                    ) : null}

                    {stage.id === 'scale' ? (
                      <>
                        <label className="field">
                          <span>Altura destino</span>
                          <select
                            value={clean.targetHeight}
                            onChange={(event) =>
                              patch({ targetHeight: Number(event.target.value) })
                            }
                            disabled={busy}
                          >
                            {TARGET_HEIGHTS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={clean.highPrecision}
                            onChange={(event) => patch({ highPrecision: event.target.checked })}
                            disabled={busy}
                          />
                          <span>Espacio de trabajo de 16 bits</span>
                        </label>
                      </>
                    ) : null}

                    {stage.id === 'unsharp' ? (
                      <>
                        <label className="field denoise-strength">
                          <span>
                            Cantidad <output>{clean.unsharpAmount.toFixed(2)}</output>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={3}
                            step={0.05}
                            value={clean.unsharpAmount}
                            aria-label="Cantidad de la máscara de enfoque"
                            onChange={(event) =>
                              patch({ unsharpAmount: Number(event.target.value) })
                            }
                            disabled={busy}
                          />
                        </label>
                        <label className="field">
                          <span>Matriz</span>
                          <select
                            value={clean.unsharpSize}
                            onChange={(event) => patch({ unsharpSize: Number(event.target.value) })}
                            disabled={busy}
                          >
                            <option value={3}>3×3 · bordes finos</option>
                            <option value={5}>5×5 · equilibrado</option>
                            <option value={7}>7×7 · texturas</option>
                            <option value={9}>9×9 · contornos amplios</option>
                          </select>
                        </label>
                      </>
                    ) : null}

                    {stage.id === 'curve' ? (
                      <label className="field denoise-strength">
                        <span>
                          Profundidad <output>{clean.curve}%</output>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={clean.curve}
                          aria-label="Fuerza de la curva S"
                          onChange={(event) => patch({ curve: Number(event.target.value) })}
                          disabled={busy}
                        />
                      </label>
                    ) : null}

                    {stage.id === 'grain' ? (
                      <label className="field denoise-strength">
                        <span>
                          Intensidad <output>{clean.grain.toFixed(1)}%</output>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={3}
                          step={0.1}
                          value={clean.grain}
                          aria-label="Intensidad del grano"
                          onChange={(event) => patch({ grain: Number(event.target.value) })}
                          disabled={busy}
                        />
                      </label>
                    ) : null}
                  </div>

                  <p className="clarity-stage-why">{stage.why}</p>
                </article>
              );
            })}
          </div>

          <div className="denoise-preview-head">
            <div>
              <strong>{mode === 'video' ? 'Preview del video' : 'Preview de la imagen'}</strong>
              <span>{claritySummary(clean, sourceHeight)}</span>
            </div>
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
          <RealtimeClarityPreview
            src={inputUrl}
            kind={mode}
            settings={clean}
            enabled={!showOriginal}
          />

          <p className="fine-print clarity-chain">
            Cadena FFmpeg: <code>{chain || 'sin etapas activas'}</code>
          </p>
          <p className="fine-print">{CLARITY_ENCODER_NOTE}</p>

          {busy && progress !== null ? (
            <div className="compress-progress" role="status" aria-live="polite">
              <div className="compress-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(progress)}%` }} />
              </div>
              <p className="compress-numbers">{Math.round(progress)} %</p>
            </div>
          ) : null}

          <div className="compress-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void run()}
              disabled={busy || stages.length === 0}
              title={
                stages.length === 0
                  ? 'Activá al menos una etapa para renderizar'
                  : 'Procesar el archivo completo con FFmpeg'
              }
            >
              <Icon name="sparkles" size={15} />
              <span>{busy ? 'Procesando…' : 'Aplicar y guardar'}</span>
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void chooseFolder()}
              disabled={busy}
            >
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
            {formatSharpenBytes(result.sourceBytes)} →{' '}
            <strong>{formatSharpenBytes(result.bytes)}</strong>
            {result.durationSeconds ? ` · ${formatSharpenDuration(result.durationSeconds)}` : ''}
          </p>
          <p className="compress-path">{result.path}</p>
          <p className="fine-print">
            {result.sourceWidth && result.sourceHeight
              ? `${result.sourceWidth}×${result.sourceHeight} → `
              : ''}
            {result.width && result.height ? `${result.width}×${result.height}` : '—'} ·{' '}
            <code>{result.encoder}</code>
          </p>
          <p className="fine-print clarity-chain">
            Cadena aplicada: <code>{result.filter}</code>
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
            <button type="button" className="ghost icon-text" onClick={compareImage}>
              <Icon name="split" size={15} />
              <span>Comparar antes y después</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
