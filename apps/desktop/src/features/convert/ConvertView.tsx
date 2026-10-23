import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  ConversionResult,
  ConversionTarget,
  EncoderPreference,
  EnhanceOptions,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

const TARGETS: ReadonlyArray<{
  value: ConversionTarget;
  label: string;
  group: 'Imagen' | 'Video' | 'Audio';
  accepts: readonly Asset['kind'][];
}> = [
  { value: 'png', label: 'PNG', group: 'Imagen', accepts: ['image', 'video'] },
  { value: 'jpg', label: 'JPEG', group: 'Imagen', accepts: ['image', 'video'] },
  { value: 'webp', label: 'WebP', group: 'Imagen', accepts: ['image', 'video'] },
  { value: 'bmp', label: 'BMP', group: 'Imagen', accepts: ['image', 'video'] },
  { value: 'tiff', label: 'TIFF', group: 'Imagen', accepts: ['image', 'video'] },
  { value: 'mp4', label: 'MP4 (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'hevc', label: 'MP4 (H.265/HEVC)', group: 'Video', accepts: ['video'] },
  { value: 'mkv', label: 'MKV (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'webm', label: 'WebM (VP9/Opus)', group: 'Video', accepts: ['video'] },
  { value: 'mov', label: 'MOV (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'avi', label: 'AVI (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'flv', label: 'FLV (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'ts', label: 'MPEG-TS (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'gif', label: 'GIF animado', group: 'Video', accepts: ['video'] },
  { value: 'mp3', label: 'MP3', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'wav', label: 'WAV', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'm4a', label: 'M4A/AAC', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'aac', label: 'AAC', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'ogg', label: 'OGG (Opus)', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'opus', label: 'Opus', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'flac', label: 'FLAC sin pérdida', group: 'Audio', accepts: ['video', 'audio'] },
];

const VIDEO_TARGETS: readonly ConversionTarget[] = [
  'mp4',
  'hevc',
  'mkv',
  'webm',
  'mov',
  'avi',
  'flv',
  'ts',
  'gif',
];

function targetInfo(target: ConversionTarget) {
  return TARGETS.find((item) => item.value === target) ?? TARGETS[3]!;
}

function accepts(target: ConversionTarget, asset: Asset): boolean {
  return targetInfo(target).accepts.includes(asset.kind);
}

function kindLabel(kind: Asset['kind']): string {
  return { video: 'Video', image: 'Imagen', audio: 'Audio', font: 'Fuente', text: 'Texto' }[kind];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

interface ConversionOutcome {
  readonly assetId: string;
  readonly label: string;
  readonly status: 'ok' | 'error';
  readonly path?: string | undefined;
  readonly bytes?: number | undefined;
  readonly sourceBytes?: number | undefined;
  readonly formatName?: string | undefined;
  readonly encoder?: string | undefined;
  readonly message?: string | undefined;
}

/** Ahorro respecto del origen; null si no se conoce el tamaño de origen. */
function savingsPercent(outcome: ConversionOutcome): number | null {
  if (outcome.status !== 'ok' || outcome.bytes === undefined) return null;
  const source = outcome.sourceBytes ?? 0;
  if (source <= 0 || outcome.bytes >= source) return null;
  return Math.round((1 - outcome.bytes / source) * 100);
}

export function ConvertView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const assets = useMemo(
    () => (project?.assets ?? []).filter((asset) => asset.status === 'ready'),
    [project],
  );
  const [target, setTarget] = useState<ConversionTarget>('mp4');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState(0);
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConversionOutcome[]>([]);
  // --- codificación: encoder, mejora y compresión por tamaño ---
  const [encoder, setEncoder] = useState<EncoderPreference>('auto');
  const [enhance, setEnhance] = useState({ denoise: false, sharpen: false, normalizeAudio: false });
  const [compressMode, setCompressMode] = useState<'quality' | 'size'>('quality');
  const [targetMegabytes, setTargetMegabytes] = useState(10);
  const [audioKbps, setAudioKbps] = useState(128);
  const [compressTarget, setCompressTarget] = useState<'mp4' | 'mkv' | 'hevc'>('mp4');
  const [hardware, setHardware] = useState<{ h264: string | null; hevc: string | null } | null>(null);

  // --- caja de herramientas (merge, recorte, marca de agua, metadatos) ---
  type ToolId = 'none' | 'merge' | 'trim' | 'watermark' | 'metadata';
  const [tool, setTool] = useState<ToolId>('none');
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set());
  const [trimAsset, setTrimAsset] = useState('');
  const [trimStart, setTrimStart] = useState('0');
  const [trimEnd, setTrimEnd] = useState('5');
  const [wmAsset, setWmAsset] = useState('');
  const [wmText, setWmText] = useState('');
  const [wmPosition, setWmPosition] = useState('bottom-right');
  const [metaAsset, setMetaAsset] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaArtist, setMetaArtist] = useState('');
  const [metaComment, setMetaComment] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const [toolResult, setToolResult] = useState<string | null>(null);

  const videoAssets = useMemo(() => assets.filter((asset) => asset.kind === 'video'), [assets]);
  const metadataAssets = useMemo(
    () => assets.filter((asset) => asset.kind === 'video' || asset.kind === 'audio'),
    [assets],
  );

  const compatible = assets.filter((asset) => accepts(target, asset));
  const selectedCompatible = compatible.filter((asset) => selected.has(asset.id));
  const supportsQuality = !['png', 'bmp', 'tiff', 'wav'].includes(target);
  const supportsWidth = [
    'png',
    'jpg',
    'webp',
    'bmp',
    'tiff',
    'mp4',
    'hevc',
    'mkv',
    'webm',
    'mov',
    'avi',
    'flv',
    'ts',
    'gif',
  ].includes(target);
  const hasEnhance = enhance.denoise || enhance.sharpen || enhance.normalizeAudio;
  const selectedVideos = selectedCompatible.filter((asset) => asset.kind === 'video').length;
  const hardwareLabel = hardware
    ? [hardware.h264 ? `H.264: ${hardware.h264}` : null, hardware.hevc ? `HEVC: ${hardware.hevc}` : null]
        .filter(Boolean)
        .join(' · ') || 'sin encoders de hardware'
    : 'sin datos';

  useEffect(() => {
    setSelected(new Set());
    setOutcomes([]);
    setOutputDir(store.state.opened?.root ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // ¿Hay encoder de hardware? Se consulta una vez por proyecto para ofrecer la
  // opción con datos reales en lugar de prometer velocidad que no existe.
  useEffect(() => {
    let cancelled = false;
    if (!store.service.available) return;
    void store.service
      .hardwareEncoders()
      .then((info) => {
        if (!cancelled) setHardware({ h264: info.h264, hevc: info.hevc });
      })
      .catch(() => {
        if (!cancelled) setHardware(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    setOutcomes([]);
  }, [target]);

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">No hay un proyecto abierto. Creá o abrí uno para convertir medios.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllCompatible(): void {
    setSelected(new Set(compatible.map((asset) => asset.id)));
  }

  async function chooseDirectory(): Promise<void> {
    try {
      const chosen = await store.service.chooseExportDirectory();
      if (chosen) setOutputDir(chosen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo elegir la carpeta');
    }
  }

  function toggleMerge(id: string): void {
    setMergeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runTool(
    label: string,
    action: () => Promise<{ path: string; bytes: number; message: string }>,
  ): Promise<void> {
    if (!outputDir) {
      setToolError('Elegí una carpeta de destino.');
      return;
    }
    setToolBusy(true);
    setToolError(null);
    setToolResult(null);
    try {
      const result = await action();
      setToolResult(`${label}: ${result.message} · ${formatBytes(result.bytes)} · ${result.path}`);
      store.setNotice(`${label} listo.`);
    } catch (cause) {
      setToolError(cause instanceof Error ? cause.message : `${label} falló`);
    } finally {
      setToolBusy(false);
    }
  }

  async function convert(): Promise<void> {
    if (selectedCompatible.length === 0) {
      setError('Elegí al menos un medio compatible con el formato.');
      return;
    }
    if (!outputDir) {
      setError('Elegí una carpeta de destino.');
      return;
    }
    setBusy(true);
    setError(null);
    setOutcomes([]);
    const collected: ConversionOutcome[] = [];
    let stopProgress: (() => void) | null = null;
    try {
      stopProgress = await store.service.onConvertProgress((event) => {
        setProgress(
          event.phase === 'start'
            ? `Convirtiendo ${event.index + 1}/${event.total} · ${event.label}`
            : `Listo ${event.index + 1}/${event.total} · ${event.label}`,
        );
      });
      const items = await store.service.convertMediaBatch(
        selectedCompatible.map((asset) => asset.id),
        target,
        outputDir,
        supportsQuality ? quality : undefined,
        supportsWidth && maxWidth > 0 ? maxWidth : undefined,
        encoder,
        hasEnhance ? (enhance as EnhanceOptions) : undefined,
      );
      for (const item of items) {
        collected.push({
          assetId: item.assetId,
          label: item.label,
          status: item.ok ? 'ok' : 'error',
          path: item.path,
          bytes: item.bytes,
          sourceBytes: item.sourceBytes,
          formatName: item.formatName,
          encoder: item.encoder,
          message: item.message,
        });
      }
      setOutcomes([...collected]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'la conversión falló');
    } finally {
      stopProgress?.();
      setBusy(false);
      setProgress('');
    }
  }

  async function compress(): Promise<void> {
    const video = selectedCompatible.filter((asset) => asset.kind === 'video');
    if (video.length === 0) {
      setError('Elegí al menos un video para comprimir.');
      return;
    }
    if (!outputDir) {
      setError('Elegí una carpeta de destino.');
      return;
    }
    setBusy(true);
    setError(null);
    setOutcomes([]);
    const collected: ConversionOutcome[] = [];
    try {
      for (let index = 0; index < video.length; index += 1) {
        const asset = video[index];
        if (!asset) continue;
        setProgress(`Comprimiendo ${index + 1}/${video.length} · ${asset.label}`);
        try {
          const result: ConversionResult = await store.service.compressMedia({
            assetId: asset.id,
            outputDir,
            target: compressTarget,
            mode: compressMode,
            quality,
            ...(compressMode === 'size' ? { targetMegabytes } : {}),
            ...(maxWidth > 0 ? { maxWidth } : {}),
            audioKbps,
            encoder,
            ...(hasEnhance ? { enhance: enhance as EnhanceOptions } : {}),
          });
          collected.push({
            assetId: asset.id,
            label: asset.label,
            status: 'ok',
            path: result.path,
            bytes: result.bytes,
            sourceBytes: result.sourceBytes,
            formatName: result.formatName,
            encoder: result.encoder,
          });
        } catch (cause) {
          collected.push({
            assetId: asset.id,
            label: asset.label,
            status: 'error',
            message: cause instanceof Error ? cause.message : 'la compresión falló',
          });
        }
        setOutcomes([...collected]);
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <section className="view convert-view">
      <ViewToolbar
        label="Convertir"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Importar más medios</span>
          </button>
        }
      >
        <span className="view-count">{assets.length} medios listos</span>
      </ViewToolbar>

      <div className="convert-layout">
        <div className="card convert-assets">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Medios del proyecto</p>
              <h3>{assets.length} archivo(s) listos</h3>
            </div>
            <button type="button" className="small ghost" onClick={selectAllCompatible}>
              Seleccionar compatibles
            </button>
          </div>
          <p className="fine-print">
            {selectedCompatible.length} seleccionado(s) compatible(s) con {targetInfo(target).label}.
          </p>
          <div className="convert-list">
            {assets.length === 0 ? (
              <p className="empty-inline">No hay medios listos. Importalos y confirmá sus derechos en Medios.</p>
            ) : (
              assets.map((asset) => {
                const ok = accepts(target, asset);
                return (
                  <label className={ok ? 'convert-row' : 'convert-row incompatible'} key={asset.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(asset.id) && ok}
                      disabled={!ok || busy}
                      onChange={() => toggle(asset.id)}
                    />
                    <span className={`asset-kind kind-${asset.kind}`}>{kindLabel(asset.kind)}</span>
                    <strong title={asset.label}>{asset.label}</strong>
                    <span className="convert-row-state">
                      {ok ? 'compatible' : 'no compatible'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="card convert-settings">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Salida</p>
              <h3>Formato y calidad</h3>
            </div>
          </div>
          <label className="field">
            <span>Formato</span>
            <select
              value={target}
              disabled={busy}
              onChange={(event) => setTarget(event.target.value as ConversionTarget)}
            >
              {(['Imagen', 'Video', 'Audio'] as const).map((group) => (
                <optgroup key={group} label={group}>
                  {TARGETS.filter((item) => item.group === group).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {supportsQuality ? (
            <label className="field">
              <span>Calidad: {quality}</span>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                disabled={busy}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </label>
          ) : null}
          {supportsWidth ? (
            <label className="field">
              <span>Ancho máximo (0 = original)</span>
              <input
                type="number"
                min={0}
                max={32768}
                step={16}
                value={maxWidth}
                disabled={busy}
                onChange={(event) =>
                  setMaxWidth(Math.max(0, Math.min(32768, Math.round(Number(event.target.value) || 0))))
                }
              />
            </label>
          ) : null}
          {VIDEO_TARGETS.includes(target) || selectedVideos > 0 ? (
            <label className="field">
              <span>Encoder</span>
              <select
                value={encoder}
                disabled={busy}
                onChange={(event) => setEncoder(event.target.value as EncoderPreference)}
              >
                <option value="auto">Automático (GPU si existe)</option>
                <option value="hardware">Forzar hardware</option>
                <option value="software">Software (libx264/libx265)</option>
              </select>
            </label>
          ) : null}
          {VIDEO_TARGETS.includes(target) || selectedVideos > 0 ? (
            <p className="fine-print">Hardware medido: {hardwareLabel}</p>
          ) : null}
          <fieldset className="field convert-enhance" disabled={busy}>
            <legend>Mejora</legend>
            <label className="inline">
              <input
                type="checkbox"
                checked={enhance.denoise}
                onChange={(event) => setEnhance({ ...enhance, denoise: event.target.checked })}
              />
              <span>Reducir ruido</span>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={enhance.sharpen}
                onChange={(event) => setEnhance({ ...enhance, sharpen: event.target.checked })}
              />
              <span>Enfocar</span>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={enhance.normalizeAudio}
                onChange={(event) =>
                  setEnhance({ ...enhance, normalizeAudio: event.target.checked })
                }
              />
              <span>Normalizar audio (−16 LUFS)</span>
            </label>
          </fieldset>
          <label className="field">
            <span>Carpeta de destino (por defecto, la del proyecto)</span>
            <div className="convert-destination">
              <input
                type="text"
                value={outputDir}
                placeholder="Carpeta existente…"
                aria-label="Carpeta de destino"
                onChange={(event) => setOutputDir(event.target.value)}
              />
              <button type="button" className="small" onClick={() => void chooseDirectory()} disabled={busy}>
                Elegir…
              </button>
            </div>
          </label>
          <div className="convert-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void convert()}
              disabled={busy || selectedCompatible.length === 0}
            >
              <Icon name="export" size={15} />
              <span>
                {busy ? 'Procesando…' : `Convertir ${selectedCompatible.length || ''} medio(s)`}
              </span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => void compress()}
              disabled={busy || selectedVideos === 0}
              title="Comprime los videos seleccionados con calidad o tamaño objetivo"
            >
              <Icon name="filters" size={15} />
              <span>{busy ? 'Procesando…' : `Comprimir ${selectedVideos || ''} video(s)`}</span>
            </button>
          </div>

          <div className="card convert-compress">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Compresión</p>
                <h3>Calidad o tamaño objetivo</h3>
              </div>
            </div>
            <label className="field">
              <span>Contenedor</span>
              <select
                value={compressTarget}
                disabled={busy}
                onChange={(event) => setCompressTarget(event.target.value as 'mp4' | 'mkv' | 'hevc')}
              >
                <option value="mp4">MP4 (H.264)</option>
                <option value="hevc">MP4 (H.265/HEVC)</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <div className="tool-tabs" role="tablist" aria-label="Modo de compresión">
              <button
                type="button"
                role="tab"
                aria-selected={compressMode === 'quality'}
                className={compressMode === 'quality' ? 'active' : ''}
                onClick={() => setCompressMode('quality')}
              >
                <span>Por calidad</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={compressMode === 'size'}
                className={compressMode === 'size' ? 'active' : ''}
                onClick={() => setCompressMode('size')}
              >
                <span>Por tamaño</span>
              </button>
            </div>
            {compressMode === 'size' ? (
              <label className="field">
                <span>Tamaño objetivo por video (MB)</span>
                <input
                  type="number"
                  min={0.1}
                  max={20000}
                  step={0.5}
                  value={targetMegabytes}
                  disabled={busy}
                  onChange={(event) =>
                    setTargetMegabytes(
                      Math.max(0.1, Math.min(20_000, Number(event.target.value) || 0.1)),
                    )
                  }
                />
              </label>
            ) : null}
            <label className="field">
              <span>Audio (kbps)</span>
              <input
                type="number"
                min={32}
                max={512}
                step={16}
                value={audioKbps}
                disabled={busy}
                onChange={(event) =>
                  setAudioKbps(Math.max(32, Math.min(512, Math.round(Number(event.target.value) || 128))))
                }
              />
            </label>
            <p className="fine-print">
              El tamaño objetivo se convierte en un presupuesto de bitrate usando la duración medida
              del archivo: el resultado queda cerca del tamaño pedido sin bajar de 50 kbps de video.
            </p>
          </div>
          {progress ? <p className="fine-print">{progress}</p> : null}
          {error ? (
            <div className="notice notice-warning" role="status">
              {error}
            </div>
          ) : null}
          {outcomes.length > 0 ? (
            <div className="convert-results" role="status">
              <p className="eyebrow">
                {outcomes.filter((item) => item.status === 'ok').length} de {outcomes.length} listos
              </p>
              <ul>
                {outcomes.map((outcome) => {
                  const saving = savingsPercent(outcome);
                  return (
                    <li key={outcome.assetId} className={outcome.status === 'ok' ? 'ok' : 'fail'}>
                      <strong title={outcome.label}>{outcome.label}</strong>
                      {outcome.status === 'ok' ? (
                        <span>
                          {formatBytes(outcome.bytes ?? 0)}
                          {saving !== null ? ` · ${saving}% menos` : ''}
                          {outcome.encoder ? ` · ${outcome.encoder}` : ''}
                        </span>
                      ) : (
                        <span>{outcome.message ?? 'falló'}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card convert-tools">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Caja de herramientas</p>
            <h3>Unir, recortar, marcar y etiquetar</h3>
          </div>
        </div>
        <div className="tool-tabs" role="tablist" aria-label="Herramientas de medios">
          {(
            [
              { id: 'none', label: 'Ninguna', icon: 'close' },
              { id: 'merge', label: 'Unir videos', icon: 'layers' },
              { id: 'trim', label: 'Recortar', icon: 'split' },
              { id: 'watermark', label: 'Marca de agua', icon: 'text' },
              { id: 'metadata', label: 'Metadatos', icon: 'info' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tool === item.id}
              className={tool === item.id ? 'active' : ''}
              onClick={() => {
                setTool(item.id);
                setToolError(null);
                setToolResult(null);
              }}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {tool === 'none' ? (
          <p className="fine-print">
            Elegí una herramienta para trabajar sobre los medios del proyecto sin abrir el editor.
            Todas usan FFmpeg local y escriben en la carpeta de destino de arriba.
          </p>
        ) : null}

        {tool === 'merge' ? (
          <div className="tool-panel">
            <p className="fine-print">
              Elegí dos o más videos. Se unen en orden de selección con H.264/AAC; para resultados
              perfectos usá videos del mismo tamaño y orientación.
            </p>
            <div className="tool-asset-list">
              {videoAssets.length === 0 ? (
                <p className="empty-inline">No hay videos listos en el proyecto.</p>
              ) : (
                videoAssets.map((asset) => (
                  <label key={asset.id} className="convert-row">
                    <input
                      type="checkbox"
                      checked={mergeIds.has(asset.id)}
                      disabled={toolBusy}
                      onChange={() => toggleMerge(asset.id)}
                    />
                    <span className="asset-kind kind-video">Video</span>
                    <strong title={asset.label}>{asset.label}</strong>
                  </label>
                ))
              )}
            </div>
            <button
              type="button"
              className="primary icon-text"
              disabled={toolBusy || mergeIds.size < 2}
              onClick={() =>
                void runTool('Unión', () =>
                  store.service.mergeVideos([...mergeIds], outputDir),
                )
              }
            >
              <Icon name="layers" size={15} />
              <span>{toolBusy ? 'Uniendo…' : `Unir ${mergeIds.size} video(s)`}</span>
            </button>
          </div>
        ) : null}

        {tool === 'trim' ? (
          <div className="tool-panel">
            <div className="tool-grid">
              <label className="field">
                <span>Video</span>
                <select
                  value={trimAsset}
                  disabled={toolBusy}
                  onChange={(event) => setTrimAsset(event.target.value)}
                >
                  <option value="">Elegir video…</option>
                  {videoAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Desde (segundos)</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={trimStart}
                  disabled={toolBusy}
                  onChange={(event) => setTrimStart(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Hasta (segundos)</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={trimEnd}
                  disabled={toolBusy}
                  onChange={(event) => setTrimEnd(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="primary icon-text"
              disabled={toolBusy || !trimAsset}
              onClick={() =>
                void runTool('Recorte', () =>
                  store.service.trimVideo(
                    trimAsset,
                    Number(trimStart) || 0,
                    Number(trimEnd) || 0,
                    outputDir,
                  ),
                )
              }
            >
              <Icon name="split" size={15} />
              <span>{toolBusy ? 'Recortando…' : 'Recortar'}</span>
            </button>
          </div>
        ) : null}

        {tool === 'watermark' ? (
          <div className="tool-panel">
            <div className="tool-grid">
              <label className="field">
                <span>Video</span>
                <select
                  value={wmAsset}
                  disabled={toolBusy}
                  onChange={(event) => setWmAsset(event.target.value)}
                >
                  <option value="">Elegir video…</option>
                  {videoAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Texto de la marca</span>
                <input
                  type="text"
                  value={wmText}
                  maxLength={80}
                  placeholder="@tu-canal"
                  disabled={toolBusy}
                  onChange={(event) => setWmText(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Posición</span>
                <select
                  value={wmPosition}
                  disabled={toolBusy}
                  onChange={(event) => setWmPosition(event.target.value)}
                >
                  <option value="top-left">Arriba a la izquierda</option>
                  <option value="top-right">Arriba a la derecha</option>
                  <option value="bottom-left">Abajo a la izquierda</option>
                  <option value="bottom-right">Abajo a la derecha</option>
                  <option value="center">Centro</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              className="primary icon-text"
              disabled={toolBusy || !wmAsset || !wmText.trim()}
              onClick={() =>
                void runTool('Marca de agua', () =>
                  store.service.watermarkVideo(wmAsset, wmText.trim(), wmPosition, outputDir),
                )
              }
            >
              <Icon name="text" size={15} />
              <span>{toolBusy ? 'Aplicando…' : 'Aplicar marca de agua'}</span>
            </button>
          </div>
        ) : null}

        {tool === 'metadata' ? (
          <div className="tool-panel">
            <div className="tool-grid">
              <label className="field">
                <span>Archivo</span>
                <select
                  value={metaAsset}
                  disabled={toolBusy}
                  onChange={(event) => setMetaAsset(event.target.value)}
                >
                  <option value="">Elegir video o audio…</option>
                  {metadataAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Título</span>
                <input
                  type="text"
                  value={metaTitle}
                  maxLength={120}
                  disabled={toolBusy}
                  onChange={(event) => setMetaTitle(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Artista</span>
                <input
                  type="text"
                  value={metaArtist}
                  maxLength={120}
                  disabled={toolBusy}
                  onChange={(event) => setMetaArtist(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Comentario</span>
                <input
                  type="text"
                  value={metaComment}
                  maxLength={300}
                  disabled={toolBusy}
                  onChange={(event) => setMetaComment(event.target.value)}
                />
              </label>
            </div>
            <p className="fine-print">
              Los streams se copian tal cual: sólo cambian los metadatos, no se recodifica.
            </p>
            <button
              type="button"
              className="primary icon-text"
              disabled={toolBusy || !metaAsset}
              onClick={() =>
                void runTool('Metadatos', () =>
                  store.service.setMetadata(
                    metaAsset,
                    metaTitle.trim(),
                    metaArtist.trim(),
                    metaComment.trim(),
                    outputDir,
                  ),
                )
              }
            >
              <Icon name="info" size={15} />
              <span>{toolBusy ? 'Guardando…' : 'Guardar metadatos'}</span>
            </button>
          </div>
        ) : null}

        {toolError ? (
          <div className="notice notice-warning" role="status">
            {toolError}
          </div>
        ) : null}
        {toolResult ? (
          <div className="notice" role="status">
            {toolResult}
          </div>
        ) : null}
      </div>

      {outcomes.length > 0 ? (
        <div className="card convert-results">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Resultados</p>
              <h3>{outcomes.filter((item) => item.status === 'ok').length} conversión(es)</h3>
            </div>
          </div>
          <ul>
            {outcomes.map((outcome) => (
              <li key={outcome.assetId} className={outcome.status}>
                <div>
                  <strong>{outcome.label}</strong>
                  <span>
                    {outcome.status === 'ok'
                      ? `${outcome.formatName || targetInfo(target).label} · ${formatBytes(outcome.bytes ?? 0)}`
                      : outcome.message}
                  </span>
                </div>
                {outcome.status === 'ok' && outcome.path ? (
                  <div className="convert-result-actions">
                    <code>{outcome.path}</code>
                    <button
                      type="button"
                      className="small ghost"
                      onClick={() => {
                        void store.service.revealOutput(outcome.path ?? '').catch(() => {});
                      }}
                    >
                      Mostrar en carpeta
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
