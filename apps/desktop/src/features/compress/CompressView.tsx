import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  CompressAnyRequest,
  ConversionResult,
  MediaProbe,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import { queuePendingComparison } from '../compare/pending';

interface Preset {
  readonly id: 'youtube' | 'whatsapp' | 'archive';
  readonly label: string;
  readonly detail: string;
  readonly target: 'mp4';
  readonly mode: 'quality' | 'size';
  readonly maxWidth?: number;
  readonly quality?: number;
}

const PRESETS: readonly Preset[] = [
  { id: 'youtube', label: 'YouTube 1080p', detail: 'H.264 · calidad alta', target: 'mp4', mode: 'quality', maxWidth: 1920, quality: 82 },
  { id: 'whatsapp', label: 'WhatsApp', detail: 'H.264 · cabe en el chat', target: 'mp4', mode: 'size', maxWidth: 1280 },
  { id: 'archive', label: 'Archivo ligero', detail: 'H.264 · calidad media, poco peso', target: 'mp4', mode: 'quality', maxWidth: 1280, quality: 55 },
];

function megaBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function savedPercent(source: number, output: number): number {
  if (source <= 0 || output <= 0) return 0;
  const saved = Math.round((1 - output / source) * 100);
  return Math.max(0, Math.min(100, saved));
}

/**
 * Comprimir como pro: cualquier video del disco, con el número verificable.
 *
 * Fase 2 del roadmap. La entrada se acepta por contenido —ffprobe decide, no la
 * extensión— y el resultado alimenta directamente el comparador antes/después.
 */
export function CompressView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [inputPath, setInputPath] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<Preset['id']>('youtube');
  const [targetSize, setTargetSize] = useState(50);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vmaf, setVmaf] = useState<number | null>(null);
  const [vmafState, setVmafState] = useState<'idle' | 'measuring' | 'done' | 'gone'>('idle');

  // Progreso en vivo: el backend emite porcentaje real desde `-progress`.
  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void store.service.onCompressProgress((event) => {
      setProgress(event.percent);
    }).then((off) => {
      if (active) unsubscribe = off;
      else off();
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [store.service]);

  const preset: Preset =
    PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;

  async function pickInput(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await store.service.chooseVideoFile('Elegir el video a comprimir');
      if (!path) return;
      const media = await store.service.probeMediaFile(path);
      setProbe(media);
      setInputPath(media.path);
    } catch (failure) {
      setProbe(null);
      setInputPath(null);
      setError(
        failure instanceof Error ? failure.message : 'ese archivo no se puede leer como video',
      );
    } finally {
      setBusy(false);
    }
  }

  async function pickOutput(): Promise<void> {
    const folder = await store.service.chooseDownloadDirectory();
    if (folder) setOutputDir(folder);
  }

  async function compress(): Promise<void> {
    if (!inputPath) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setVmaf(null);
    setVmafState('idle');
    try {
      let destination = outputDir;
      if (!destination) {
        const folder = await store.service.chooseDownloadDirectory();
        if (!folder) {
          setError('Elegí una carpeta de destino para el video comprimido.');
          setBusy(false);
          return;
        }
        setOutputDir(folder);
        destination = folder;
      }
      const request: CompressAnyRequest =
        preset.mode === 'quality'
          ? {
              inputPath,
              outputDir: destination,
              target: preset.target,
              mode: 'quality',
              quality: preset.quality ?? 78,
              ...(preset.maxWidth ? { maxWidth: preset.maxWidth } : {}),
            }
          : {
              inputPath,
              outputDir: destination,
              target: preset.target,
              mode: 'size',
              targetMegabytes: targetSize,
              ...(preset.maxWidth ? { maxWidth: preset.maxWidth } : {}),
            };
      setResult(await store.service.compressAnyFile(request));
      setProgress(null);
      store.setNotice('Video comprimido. El antes/después quedó listo en Comparar.');
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error ? failure.message : 'la compresión falló');
    } finally {
      setBusy(false);
    }
  }

  async function measureQuality(): Promise<void> {
    if (!result || !inputPath) return;
    setVmafState('measuring');
    setError(null);
    try {
      const score = await store.service.measureVmaf(inputPath, result.path);
      if (score === null) {
        setVmafState('gone');
        return;
      }
      setVmaf(score);
      setVmafState('done');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo medir la calidad');
      setVmafState('idle');
    }
  }

  function openComparison(): void {
    if (!result || !inputPath) return;
    queuePendingComparison({ beforePath: inputPath, afterPath: result.path });
    onNavigate('compare');
  }

  const percent = result ? savedPercent(result.sourceBytes, result.bytes) : 0;

  return (
    <section className="view compress-view">
      <ViewToolbar
        label="Comprimir"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Comprimir como pro</h2>
          <p>
            Elegí cualquier video —FFmpeg decide si lo puede leer, no la extensión—,
            aplicá un preajuste y quedate con el número: cuánto pesaba y cuánto pesa.
          </p>
        </div>
      </header>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={`compress-slot${probe ? ' loaded' : ''}`}
        onClick={() => void pickInput()}
        disabled={busy}
      >
        <Icon name="film" size={16} />
        <strong>{probe ? 'Video elegido' : 'Elegir video'}</strong>
        <span>{probe ? `${probe.path.split(/[\\/]/).pop()} · ${megaBytes(probe.bytes)}` : 'cualquier formato que FFmpeg lea'}</span>
      </button>

      {probe ? (
        <dl className="compress-info" aria-label="Datos del video">
          <div>
            <dt>Resolución</dt>
            <dd>{probe.width && probe.height ? `${probe.width}×${probe.height}` : '—'}</dd>
          </div>
          <div>
            <dt>Duración</dt>
            <dd>
              {probe.durationSeconds
                ? `${Math.round(probe.durationSeconds)} s`
                : '—'}
            </dd>
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
            <dt>Formato</dt>
            <dd>{probe.formatName || '—'}</dd>
          </div>
          <div>
            <dt>Peso original</dt>
            <dd>{megaBytes(probe.bytes)}</dd>
          </div>
        </dl>
      ) : null}

      {probe ? (
        <>
          <div className="compress-presets" role="group" aria-label="Preajuste de compresión">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`compress-preset${presetId === option.id ? ' active' : ''}`}
                aria-pressed={presetId === option.id}
                onClick={() => setPresetId(option.id)}
                disabled={busy}
              >
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>

          {preset.mode === 'size' ? (
            <label className="field compress-target">
              <span>
                Tamaño objetivo <output>{targetSize} MB</output>
              </span>
              <input
                type="range"
                min={5}
                max={2000}
                step={5}
                value={targetSize}
                aria-label="Tamaño objetivo en megabytes"
                onChange={(event) => setTargetSize(Number(event.target.value))}
                disabled={busy}
              />
            </label>
          ) : null}

          {busy && progress !== null ? (
            <div className="compress-progress" role="status" aria-live="polite">
              <div className="compress-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(progress)}%` }} />
              </div>
              <p className="compress-numbers">{Math.round(progress)} %</p>
            </div>
          ) : null}
          <div className="compress-actions">
            <button type="button" className="primary icon-text" onClick={() => void compress()} disabled={busy}>
              <Icon name="save" size={15} />
              <span>{busy ? 'Comprimiendo…' : 'Comprimir'}</span>
            </button>
            <button type="button" className="ghost" onClick={() => void pickOutput()} disabled={busy}>
              Carpeta: {outputDir ? outputDir.split(/[\\/]/).pop() : 'elegir…'}
            </button>
          </div>
          <p className="fine-print">
            La compresión corre con FFmpeg local, muestra el porcentaje real que informa FFmpeg y
            usa aceleración de hardware si tu placa la ofrece.
          </p>
        </>
      ) : null}

      {result ? (
        <div className="compress-result" role="status">
          <div className="compress-bar" aria-hidden="true">
            <span style={{ width: `${100 - percent}%` }} />
          </div>
          <p className="compress-numbers">
            {megaBytes(result.sourceBytes)} → <strong>{megaBytes(result.bytes)}</strong> ·{' '}
            {percent}% menos · {result.encoder}
          </p>
          <p className="compress-path">{result.path}</p>
          {vmaf !== null ? (
            <p className="compress-vmaf">
              Calidad objetiva <strong>VMAF {vmaf.toFixed(1)}</strong> contra el original
              (93+ se ve idéntico; 80+ conserva la calidad para redes).
            </p>
          ) : null}
          {vmafState === 'idle' ? (
            <button type="button" className="ghost icon-text" onClick={() => void measureQuality()}>
              <Icon name="sparkles" size={14} />
              <span>Medir calidad (VMAF)</span>
            </button>
          ) : null}
          {vmafState === 'measuring' ? (
            <p className="fine-print">Midiendo calidad objetiva contra el original…</p>
          ) : null}
          {vmafState === 'gone' ? (
            <p className="fine-print">
              Este build de FFmpeg no trae libvmaf: la medición objetiva no está disponible en
              esta máquina.
            </p>
          ) : null}
          <button type="button" className="primary icon-text" onClick={openComparison}>
            <Icon name="split" size={15} />
            <span>Comparar antes y después</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
