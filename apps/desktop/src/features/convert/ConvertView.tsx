import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type { ConversionResult, ConversionTarget } from '../../services/project-service';
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
  { value: 'mp4', label: 'MP4 (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'webm', label: 'WebM (VP9/Opus)', group: 'Video', accepts: ['video'] },
  { value: 'mov', label: 'MOV (H.264/AAC)', group: 'Video', accepts: ['video'] },
  { value: 'gif', label: 'GIF animado', group: 'Video', accepts: ['video'] },
  { value: 'mp3', label: 'MP3', group: 'Audio', accepts: ['video', 'audio'] },
  { value: 'wav', label: 'WAV', group: 'Audio', accepts: ['video', 'audio'] },
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
  readonly path?: string;
  readonly bytes?: number;
  readonly formatName?: string;
  readonly message?: string;
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

  const compatible = assets.filter((asset) => accepts(target, asset));
  const selectedCompatible = compatible.filter((asset) => selected.has(asset.id));
  const supportsQuality = target !== 'png' && target !== 'wav';
  const supportsWidth = target === 'png' || target === 'jpg' || target === 'webp' || target === 'mp4' || target === 'webm' || target === 'mov' || target === 'gif';

  useEffect(() => {
    setSelected(new Set());
    setOutcomes([]);
    setOutputDir(store.state.opened?.root ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    setOutcomes([]);
  }, [target]);

  if (!project) {
    return (
      <section className="view">
        <div className="view-head">
          <div>
            <p className="eyebrow">Herramientas</p>
            <h2>Convertir</h2>
            <p className="view-summary">Convertí imagen, video y audio a formatos comunes.</p>
          </div>
        </div>
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
    try {
      for (let index = 0; index < selectedCompatible.length; index += 1) {
        const asset = selectedCompatible[index];
        if (!asset) continue;
        setProgress(`Convirtiendo ${index + 1}/${selectedCompatible.length} · ${asset.label}`);
        try {
          const result: ConversionResult = await store.service.convertMedia({
            assetId: asset.id,
            target,
            outputDir,
            ...(supportsQuality ? { quality } : {}),
            ...(supportsWidth && maxWidth > 0 ? { maxWidth } : {}),
          });
          collected.push({
            assetId: asset.id,
            label: asset.label,
            status: 'ok',
            path: result.path,
            bytes: result.bytes,
            formatName: result.formatName,
          });
        } catch (cause) {
          collected.push({
            assetId: asset.id,
            label: asset.label,
            status: 'error',
            message: cause instanceof Error ? cause.message : 'la conversión falló',
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
      <div className="view-head">
        <div>
          <p className="eyebrow">Herramientas de medios</p>
          <h2>Convertir</h2>
          <p className="view-summary">
            Convertí los medios del proyecto a imagen, video o audio con FFmpeg local. Nunca se
            sobrescribe un archivo existente y cada salida se verifica.
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Importar más medios</span>
          </button>
        </div>
      </div>

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
                max={16384}
                step={16}
                value={maxWidth}
                disabled={busy}
                onChange={(event) =>
                  setMaxWidth(Math.max(0, Math.min(16384, Math.round(Number(event.target.value) || 0))))
                }
              />
            </label>
          ) : null}
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
          <button
            type="button"
            className="primary icon-text"
            onClick={() => void convert()}
            disabled={busy || selectedCompatible.length === 0}
          >
            <Icon name="export" size={15} />
            <span>
              {busy ? 'Convirtiendo…' : `Convertir ${selectedCompatible.length || ''} medio(s)`}
            </span>
          </button>
          {progress ? <p className="fine-print">{progress}</p> : null}
          {error ? (
            <div className="notice notice-warning" role="status">
              {error}
            </div>
          ) : null}
        </div>
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
