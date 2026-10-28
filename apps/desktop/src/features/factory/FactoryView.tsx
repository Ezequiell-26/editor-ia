import { useEffect, useMemo, useState } from 'react';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import {
  assembleVariant,
  generateVariant,
  planVariants,
  type FactoryBrief,
  type FactoryVariantResult,
} from '../../state/batch-factory';
import { useProjectStore } from '../../state/project-store';
import { useLicense } from '../../state/LicenseProvider';
import { ProLock } from '../../components/ProLock';
import { buildProjectMotionPlans } from '../motion/plan';
import { AutopilotPanel } from './AutopilotPanel';

interface FactoryImage {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

function readyImages(project: ProjectDocument): FactoryImage[] {
  return project.assets
    .filter(
      (asset): asset is Extract<Asset, { kind: 'image' }> =>
        asset.kind === 'image' && asset.status === 'ready' && asset.source.type === 'local',
    )
    .map((asset) => ({
      id: asset.id,
      label: asset.label,
      path: asset.source.type === 'local' ? asset.source.path : '',
      hash: asset.integrity?.sha256 ?? '',
      bytes: asset.integrity?.bytes ?? 0,
      width: asset.media?.width ?? 1920,
      height: asset.media?.height ?? 1080,
    }))
    .filter((image) => image.path && image.hash);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

export function FactoryView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const { status, loading } = useLicense();
  if (!loading && !status.isPro) {
    return (
      <ProLock
        feature="Fábrica de Variantes"
        description="Generar varios proyectos y renders desde un brief, con imágenes compartidas y montaje automático, forma parte de Pro."
        onOpenSettings={() => onNavigate('settings')}
      />
    );
  }
  return <FactoryWorkspace onNavigate={onNavigate} />;
}

function FactoryWorkspace({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const images = useMemo(() => (project ? readyImages(project) : []), [project]);
  const [brief, setBrief] = useState(() => {
    const handoff = localStorage.getItem('editoria.factory.brief') ?? '';
    localStorage.removeItem('editoria.factory.brief');
    return handoff;
  });
  const [variants, setVariants] = useState(3);
  const [scenes, setScenes] = useState(5);
  const [language, setLanguage] = useState('es');
  const [format, setFormat] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [outputDir, setOutputDir] = useState('');
  const [photoMotion, setPhotoMotion] = useState<'auto' | 'none'>('auto');
  const [transitionFrames, setTransitionFrames] = useState(8);
  const [confirmRights, setConfirmRights] = useState(false);
  const [approveCost, setApproveCost] = useState(false);
  const [renderVideos, setRenderVideos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FactoryVariantResult[]>([]);

  useEffect(() => {
    if (!project) return;
    setSelectedImages(new Set(readyImages(project).map((image) => image.id)));
    setOutputDir(root ? `${root}\\variantes` : '');
    setResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, root]);

  if (!project) {
    return (
      <section className="view">
        <article className="factory-empty">
          <div className="factory-empty-mark" aria-hidden="true">
            <Icon name="layers" size={26} />
          </div>
          <div>
            <p className="eyebrow">Cómo funciona</p>
            <h3>Un brief, varias variantes listas para editar</h3>
            <p className="muted">
              La fábrica escribe un proyecto portable por variante, con guion, voz local,
              imágenes compartidas, subtítulos y montaje automático. No publica ni consume
              créditos externos.
            </p>
          </div>
          <ol className="factory-empty-steps">
            <li><strong>Abrí un proyecto</strong><span>Elegí formato y fps; después importá al menos una imagen lista.</span></li>
            <li><strong>Elegí las imágenes</strong><span>Se comparten entre las variantes para ahorrar espacio y trabajo.</span></li>
            <li><strong>Generá y revisá</strong><span>La fábrica crea los proyectos y, si querés, un MP4 por variante.</span></li>
          </ol>
          <div className="actions">
            <button type="button" className="primary" onClick={() => onNavigate('projects')}>
              Ir a Proyectos
            </button>
            <button type="button" className="ghost" onClick={() => onNavigate('learn')}>
              Ver tutorial
            </button>
          </div>
        </article>
      </section>
    );
  }

  const chosenImages = images.filter((image) => selectedImages.has(image.id));
  const dimensions =
    format === '16:9'
      ? { width: 1920, height: 1080 }
      : format === '9:16'
        ? { width: 1080, height: 1920 }
        : { width: 1080, height: 1080 };

  function toggleImage(id: string): void {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function slug(value: string): string {
    const cleaned = value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (cleaned || 'variante').slice(0, 80);
  }

  async function generate(): Promise<void> {
    if (!brief.trim()) {
      setError('Escribí un brief o tema para las variantes.');
      return;
    }
    if (chosenImages.length === 0) {
      setError('Elegí al menos una imagen lista para las variantes.');
      return;
    }
    if (!outputDir.trim()) {
      setError('Indicá una carpeta de salida para las variantes.');
      return;
    }
    if (!confirmRights) {
      setError('Confirmá los derechos de las imágenes y de la voz antes de generar.');
      return;
    }
    setBusy(true);
    setError(null);
    setResults([]);
    const factoryBrief: FactoryBrief = {
      topic: brief.trim(),
      variants,
      scenes,
      language,
      width: dimensions.width,
      height: dimensions.height,
      fpsNum: 30,
      fpsDen: 1,
    };
    const plans = planVariants(factoryBrief);
    const runId = Date.now().toString(36).slice(-5);
    const collected: FactoryVariantResult[] = [];
    try {
      for (const plan of plans) {
        setStage(`Generando ${plan.index + 1}/${plans.length} · ${plan.name}`);
        try {
          const variant = await generateVariant(
            store.service,
            factoryBrief,
            plan,
            chosenImages,
            {
              photoMotion,
              transitionFrames,
              confirmRights,
              approveCost,
            },
          );
          const assembled = assembleVariant(variant.project, variant.narrations, {
            photoMotion,
            transitionFrames,
            confirmRights,
          });
          const written = await store.service.writeProjectVariant({
            directory: outputDir,
            fileName: `${plan.name}-${runId}`,
            project: assembled,
          });
          const durationFrames = assembled.timeline.clips.reduce(
            (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
            0,
          );
          let videoPath: string | undefined;
          let videoBytes: number | undefined;
          let renderError: string | undefined;
          if (renderVideos) {
            setStage(`Renderizando ${plan.index + 1}/${plans.length} · ${plan.name}`);
            try {
              const motionBundle = buildProjectMotionPlans(assembled);
              if (motionBundle.errors.length > 0) throw new Error(motionBundle.errors[0]);
              const rendered = await store.service.renderProjectVariant({
                projectPath: written.path,
                profileId: assembled.renderProfiles[0]?.id ?? '',
                outputPath: `${outputDir}\\${slug(plan.name)}-${runId}.mp4`,
                includeCaptions: true,
                motionPlans: motionBundle.plans,
              });
              videoPath = rendered.path;
              videoBytes = rendered.bytes;
            } catch (cause) {
              renderError = cause instanceof Error ? cause.message : 'el render falló';
            }
          }
          collected.push({
            index: plan.index,
            name: plan.name,
            projectPath: written.path,
            ...(videoPath ? { videoPath } : {}),
            ...(videoBytes !== undefined ? { videoBytes } : {}),
            ...(renderError ? { renderError } : {}),
            status: 'ok',
            message: `${formatBytes(written.bytes)} · ${written.copiedAssets} medio(s) copiados${
              renderError ? ` · render: ${renderError}` : videoBytes ? ` · MP4 ${formatBytes(videoBytes)}` : ''
            }`,
            durationFrames,
            clipCount: assembled.timeline.clips.length,
            captionCount: assembled.captions.cues.length,
          });
        } catch (cause) {
          collected.push({
            index: plan.index,
            name: plan.name,
            projectPath: null,
            status: 'error',
            message: cause instanceof Error ? cause.message : 'la variante falló',
            durationFrames: 0,
            clipCount: 0,
            captionCount: 0,
          });
        }
        setResults([...collected]);
      }
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  return (
    <section className="view factory-view">
      <ViewToolbar label="Fábrica">
        <span className={`status-pill ${busy ? 'saving' : 'saved'}`}>
          <span className={`status-pill-dot phase-${busy ? 'saving' : 'saved'}`} aria-hidden="true" />
          {busy ? 'Generando' : `${results.filter((item) => item.status === 'ok').length} listas`}
        </span>
        <span className="view-count">{variants} variante(s)</span>
      </ViewToolbar>

      {(
        <div className="factory-layout">
          <div className="factory-main">
            <div className="card factory-brief">
              <p className="eyebrow">Brief</p>
              <label className="field">
                <span>Qué querés contar</span>
                <textarea
                  value={brief}
                  rows={4}
                  placeholder="Ej.: un tutorial corto sobre cómo ordenar una timeline sin perder sincronía…"
                  onChange={(event) => setBrief(event.target.value)}
                />
              </label>
              <div className="factory-grid">
                <label className="field">
                  <span>Variantes</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={variants}
                    onChange={(event) =>
                      setVariants(Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 1))))
                    }
                  />
                </label>
                <label className="field">
                  <span>Escenas por variante</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={scenes}
                    onChange={(event) =>
                      setScenes(Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 1))))
                    }
                  />
                </label>
                <label className="field">
                  <span>Idioma</span>
                  <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                    <option value="es">Español</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="field">
                  <span>Formato</span>
                  <select
                    value={format}
                    onChange={(event) => setFormat(event.target.value as '16:9' | '9:16' | '1:1')}
                  >
                    <option value="16:9">Horizontal 16:9</option>
                    <option value="9:16">Vertical 9:16</option>
                    <option value="1:1">Cuadrado 1:1</option>
                  </select>
                </label>
              </div>
            </div>

            <AutopilotPanel
              project={project}
              service={store.service}
              defaults={{
                brief,
                scenes,
                language,
                width: dimensions.width,
                height: dimensions.height,
                outputDir,
                photoMotion,
                transitionFrames,
                renderVideo: renderVideos,
                confirmRights,
              }}
              onOpenProject={(path) => store.openProjectAt(path)}
              onNavigateEditor={() => onNavigate('editor')}
              onNavigateMcp={() => onNavigate('mcp')}
            />

            <div className="card">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Imágenes compartidas</p>
                  <h3>{chosenImages.length} de {images.length} seleccionadas</h3>
                </div>
                {images.length > 0 ? (
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => setSelectedImages(new Set(images.map((image) => image.id)))}
                  >
                    Seleccionar todas
                  </button>
                ) : null}
              </div>
              {images.length === 0 ? (
                <p className="fine-print">
                  La fábrica clásica necesita imágenes. Importá y confirmá al menos una en Medios, o
                  usá el autopiloto para generar los medios con Flow.
                </p>
              ) : (
                <div className="factory-images">
                  {images.map((image) => (
                    <label className="factory-image" key={image.id}>
                      <input
                        type="checkbox"
                        checked={selectedImages.has(image.id)}
                        onChange={() => toggleImage(image.id)}
                      />
                      <span>
                        <strong>{image.label}</strong>
                        <em>{image.width}×{image.height}</em>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="card factory-output">
              <p className="eyebrow">Salida</p>
              <label className="field">
                <span>Carpeta de variantes</span>
                <input
                  type="text"
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                  placeholder="Carpeta existente o nueva…"
                />
              </label>
              <div className="factory-grid">
                <label className="field">
                  <span>Movimiento de fotos</span>
                  <select
                    value={photoMotion}
                    onChange={(event) => setPhotoMotion(event.target.value as 'auto' | 'none')}
                  >
                    <option value="auto">Ken Burns alternado</option>
                    <option value="none">Sin movimiento</option>
                  </select>
                </label>
                <label className="field">
                  <span>Transición (frames)</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={transitionFrames}
                    onChange={(event) =>
                      setTransitionFrames(
                        Math.max(0, Math.min(30, Math.round(Number(event.target.value) || 0))),
                      )
                    }
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={renderVideos}
                  onChange={(event) => setRenderVideos(event.target.checked)}
                />
                <span>Renderizar un MP4 por variante (más lento, secuencial).</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmRights}
                  onChange={(event) => setConfirmRights(event.target.checked)}
                />
                <span>Confirmo derechos de las imágenes y de la voz para estas variantes.</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={approveCost}
                  onChange={(event) => setApproveCost(event.target.checked)}
                />
                <span>
                  Autorizo el consumo de créditos si el proveedor de guion es remoto.
                  Con proveedor local no hace falta.
                </span>
              </label>
              <button
                type="button"
                className="primary icon-text"
                onClick={() => void generate()}
                disabled={busy}
              >
                <Icon name="layers" size={15} />
                <span>{busy ? 'Generando variantes…' : `Generar ${variants} variante(s)`}</span>
              </button>
              {stage ? <p className="fine-print director-stage">{stage}</p> : null}
              {error ? <p className="notice notice-warning" role="status">{error}</p> : null}
            </div>

            {results.length > 0 ? (
              <div className="card factory-results">
                <div className="production-card-head">
                  <div>
                    <p className="eyebrow">Variantes</p>
                    <h3>{results.filter((item) => item.status === 'ok').length} de {results.length} listas</h3>
                  </div>
                </div>
                <ul>
                  {results.map((result) => (
                    <li key={result.index} className={result.status}>
                      <div>
                        <strong>{result.name}</strong>
                        <span>
                          {result.status === 'ok'
                            ? `${result.clipCount} clips · ${result.captionCount} subtítulos · ${(result.durationFrames / 30).toFixed(1)} s`
                            : result.message}
                        </span>
                        {result.projectPath ? <code>{result.projectPath}</code> : null}
                        {result.videoPath ? <code>{result.videoPath}</code> : null}
                      </div>
                      {result.status === 'ok' && result.projectPath ? (
                        <div className="actions compact">
                          <button
                            type="button"
                            className="small ghost"
                            onClick={() => void store.service.revealOutput(result.projectPath ?? '').catch(() => {})}
                          >
                            Mostrar
                          </button>
                          <button
                            type="button"
                            className="small"
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Se va a abrir esta variante y se reemplazará el proyecto actual. ¿Continuar?',
                                )
                              ) {
                                void store.openProjectAt(result.projectPath!).then((ok) => {
                                  if (ok) onNavigate('editor');
                                });
                              }
                            }}
                          >
                            Abrir
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <aside className="factory-side">
            <div className="card">
              <p className="eyebrow">Cómo funciona</p>
              <ul className="factory-help">
                <li>Cada variante pide un guion distinto al proveedor configurado.</li>
                <li>Sintetiza la voz escena por escena y monta imágenes con duración exacta.</li>
                <li>Genera subtítulos, Ken Burns y transiciones configurables.</li>
                <li>Escribe un `.editoria.json` portable y comparte la carpeta `media/`.</li>
                <li>Si activás el render, genera un MP4 por variante en la misma carpeta.</li>
              </ul>
            </div>
            <div className="card">
              <p className="eyebrow">Proveedor actual</p>
              <p className="fine-print">
                La fábrica usa el proveedor de guion configurado y SAPI local para la voz del lote, sin consumir créditos externos. Con el proveedor simulado podés probar el flujo completo sin red.
              </p>
              <button type="button" className="ghost small" onClick={() => onNavigate('settings')}>
                Revisar proveedores
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
