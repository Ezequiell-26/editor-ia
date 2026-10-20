import { useEffect, useMemo, useState } from 'react';
import type { Asset, Scene } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import type { VoiceInfo } from '../../services/project-service';
import {
  formatTimecode,
  fpsOf,
} from '../../state/project-actions';
import {
  prepareAutoEdit,
  type AutoEditPlan,
  type NarrationCandidate,
} from '../../state/auto-edit';
import { useProjectStore } from '../../state/project-store';
import { PublicationReadiness } from './PublicationReadiness';

interface ProductionViewProps {
  readonly onNavigate: (id: ViewId) => void;
}

function sceneHasReadyAudio(project: { assets: readonly Asset[] }, scene: Scene): boolean {
  if (!scene.narration.assetId) return false;
  const asset = project.assets.find((item) => item.id === scene.narration.assetId);
  return asset?.kind === 'audio' && asset.status === 'ready';
}

export function ProductionView({ onNavigate }: ProductionViewProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState('');
  const [audioProviderKind, setAudioProviderKind] = useState('windows-sapi');
  const [confirmVoice, setConfirmVoice] = useState(false);
  const [generateMissingNarration, setGenerateMissingNarration] = useState(true);
  const [assignment, setAssignment] = useState<'order' | 'match'>('order');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [replaceTimeline, setReplaceTimeline] = useState(true);
  const [photoMotion, setPhotoMotion] = useState<'auto' | 'none'>('auto');
  const [transitionFrames, setTransitionFrames] = useState(8);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [plan, setPlan] = useState<AutoEditPlan | null>(null);

  useEffect(() => {
    if (!project) return;
    let active = true;
    void store.service
      .listVoices()
      .then((list) => {
        if (!active) return;
        setVoices(list);
        const preferred = list.find((item) => /^es/i.test(item.culture)) ?? list[0];
        if (preferred) setVoice((current) => current || preferred.id);
      })
      .catch(() => {
        if (active) setVoices([]);
      });
    void store.service
      .getAudioProvider()
      .then((info) => {
        if (active) setAudioProviderKind(info.kind);
      })
      .catch(() => {
        if (active) setAudioProviderKind('windows-sapi');
      });
    return () => {
      active = false;
    };
  }, [project?.id, store.service]);

  const fps = project ? fpsOf(project) : 30;
  const scenes = useMemo(
    () => (project ? [...project.scenes].sort((a, b) => a.order - b.order) : []),
    [project],
  );
  const images = useMemo(
    () =>
      project
        ? project.assets
            .filter((asset) => asset.kind === 'image' && asset.status === 'ready')
            .sort((a, b) =>
              a.label.localeCompare(b.label, 'es', { numeric: true, sensitivity: 'base' }),
            )
        : [],
    [project],
  );
  const videos = project
    ? project.assets.filter((asset) => asset.kind === 'video' && asset.status === 'ready')
    : [];
  const readyAudioCount = project
    ? scenes.filter((scene) => sceneHasReadyAudio(project, scene)).length
    : 0;
  const unreadyAudio = project
    ? scenes.filter(
        (scene) => scene.narration.assetId && !sceneHasReadyAudio(project, scene),
      )
    : [];
  const needsSynthesis = generateMissingNarration
    ? scenes.filter((scene) => scene.narration.text?.trim() && !scene.narration.assetId)
    : [];
  const requiresVoiceRights = needsSynthesis.length > 0 || unreadyAudio.length > 0;

  const estimatedFrames = scenes.reduce((sum, scene) => {
    const asset = project?.assets.find(
      (item) => item.id === scene.narration.assetId && item.kind === 'audio',
    );
    const duration =
      asset?.kind === 'audio' && asset.status === 'ready'
        ? asset.media?.durationFrames
        : scene.narration.estimatedDurationFrames;
    return sum + (duration ?? 0);
  }, 0);

  const canGenerate =
    Boolean(project) &&
    scenes.length > 0 &&
    images.length > 0 &&
    !busy &&
    (needsSynthesis.length === 0 || Boolean(voice)) &&
    (!requiresVoiceRights || confirmVoice);

  if (!project) {
    return (
      <section className="view production-view">
        <div className="view-head">
          <div>
            <p className="eyebrow">Producción</p>
            <h2>Video automático</h2>
            <p className="view-summary">
              Convertí un guion y una biblioteca de imágenes en una timeline con voz y subtítulos.
            </p>
          </div>
        </div>
        <p className="empty-state">No hay un proyecto abierto. Creá o abrí uno para producir.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  async function generateVideo(): Promise<void> {
    if (!project) return;
    if (scenes.length === 0) {
      setWarnings(['El proyecto necesita escenas de guion antes de montar el video.']);
      return;
    }
    if (images.length === 0) {
      setWarnings(['Importá y confirmá al menos una imagen en Medios.']);
      return;
    }
    if (requiresVoiceRights && !confirmVoice) {
      setWarnings(['Confirmá los derechos de la voz y del audio antes de generar.']);
      return;
    }
    setBusy(true);
    setWarnings([]);
    setPlan(null);
    try {
      const narrations: NarrationCandidate[] = [];
      let index = 0;
      for (const scene of needsSynthesis) {
        index += 1;
        setProgress(`Generando voz ${index}/${needsSynthesis.length}: ${scene.title}`);
        const text = scene.narration.text?.trim();
        if (!text) continue;
        const result = await store.service.synthesizeNarration({
          text,
          fpsNum: project.video.frameRate.num,
          fpsDen: project.video.frameRate.den,
          ...(voice ? { voice } : {}),
        });
        narrations.push({ sceneId: scene.id, asset: result.asset });
      }

      setProgress('Montando imágenes, audio y subtítulos…');
      const mutation = store.mutate((current) => {
        const result = prepareAutoEdit(
          current,
          narrations,
          { assignment, includeCaptions, replaceTimeline, photoMotion, transitionFrames },
          confirmVoice,
        );
        return { project: result.project, plan: result.plan };
      });
      if (!mutation) {
        setWarnings(['No se pudo montar el video; revisá el mensaje de error del proyecto.']);
        return;
      }
      setPlan(mutation.plan);
      setWarnings(mutation.plan.warnings);
      store.setNotice(
        `Video montado: ${mutation.plan.scenes.length} escenas en ${formatTimecode(
          mutation.plan.totalFrames,
          fps,
        )}.`,
      );
    } catch (error) {
      setWarnings([
        error instanceof Error ? error.message : 'el montaje automático falló sin detalle',
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const steps = [
    {
      id: 'prod-guion',
      label: 'Guion y escenas',
      detail: `${scenes.length} escena(s)`,
      state: scenes.length > 0 ? 'done' : 'pending',
    },
    {
      id: 'prod-recursos',
      label: 'Recursos',
      detail: `${images.length} imagen(es) · ${videos.length} video(s)`,
      state: images.length > 0 ? 'done' : 'pending',
    },
    {
      id: 'prod-voz',
      label: 'Voz y narración',
      detail: `${readyAudioCount}/${scenes.length} con audio · ${unreadyAudio.length} por confirmar`,
      state:
        scenes.length > 0 && readyAudioCount === scenes.length
          ? 'done'
          : needsSynthesis.length === 0 && unreadyAudio.length === 0
            ? 'pending'
            : 'warning',
    },
    {
      id: 'prod-montaje',
      label: 'Montaje automático',
      detail: plan ? 'Timeline generada' : 'Listo para generar',
      state: plan ? 'done' : 'pending',
    },
    {
      id: 'prod-revision',
      label: 'Revisión y export',
      detail: plan ? `${plan.captionCount} subtítulo(s)` : 'Pendiente de montaje',
      state: plan ? (warnings.length > 0 ? 'warning' : 'done') : 'pending',
    },
  ];

  return (
    <section className="view production-view">
      <div className="view-head production-head">
        <div>
          <p className="eyebrow">Producción automática</p>
          <h2>De guion a video</h2>
          <p className="view-summary">
            Voz local por escena, asignación de imágenes, subtítulos y timeline. Todo se queda en
            tu equipo; nada se envía a un servicio.
          </p>
        </div>
        <span className={`status-pill ${plan ? 'saved' : 'dirty'}`}>
          {plan ? 'Timeline generada' : 'Listo para montar'}
        </span>
      </div>

      <div className="production-stats">
        <div className="stat-card">
          <span>Escenas</span>
          <strong>{scenes.length}</strong>
        </div>
        <div className="stat-card">
          <span>Imágenes</span>
          <strong>{images.length}</strong>
        </div>
        <div className="stat-card">
          <span>Videos</span>
          <strong>{videos.length}</strong>
        </div>
        <div className="stat-card">
          <span>Duración estimada</span>
          <strong>{formatTimecode(estimatedFrames, fps)}</strong>
        </div>
      </div>

      <div className="production-grid">
        <aside className="production-steps" aria-label="Pasos de producción">
          <p className="eyebrow">Pasos</p>
          {steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={`production-step ${step.state}`}
              onClick={() => {
                document.getElementById(step.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="step-copy">
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <span className="step-state" aria-hidden="true">
                {step.state === 'done' ? '✓' : step.state === 'warning' ? '!' : '·'}
              </span>
            </button>
          ))}
          <p className="fine-print">
            La voz se sintetiza con Windows SAPI. Las imágenes se asignan por orden o por
            coincidencia de prompt; no hay CLIP ni Whisper en esta versión.
          </p>
        </aside>

        <div className="production-main">
          <article className="card" id="prod-guion">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Paso 1</p>
                <h3>Guion y escenas</h3>
              </div>
              <button type="button" className="ghost small" onClick={() => onNavigate('script')}>
                Abrir Guion
              </button>
            </div>
            <p className="muted">
              {scenes.length > 0
                ? `${scenes.length} escenas con narración escrita. La duración exacta sale del audio de cada escena.`
                : 'Todavía no hay escenas. Generá el guion o agregá escenas a mano.'}
            </p>
            {scenes.length > 0 ? (
              <ol className="production-scene-list">
                {scenes.slice(0, 6).map((scene) => (
                  <li key={scene.id}>
                    <strong>{scene.title}</strong>
                    <span>{scene.narration.text?.slice(0, 110) ?? 'sin texto'}</span>
                  </li>
                ))}
                {scenes.length > 6 ? <li className="muted">y {scenes.length - 6} más…</li> : null}
              </ol>
            ) : null}
          </article>

          <article className="card" id="prod-recursos">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Paso 2</p>
                <h3>Recursos</h3>
              </div>
              <button type="button" className="ghost small" onClick={() => onNavigate('assets')}>
                Abrir Medios
              </button>
            </div>
            <p className="muted">
              {images.length} imagen(es) y {videos.length} video(s) listos. Para Flow: importá las
              imágenes descargadas con “Auto-montar lote” o directamente en Medios.
            </p>
            <div className="production-resource-strip">
              {images.slice(0, 8).map((image) => (
                <span key={image.id} className="resource-chip" title={image.label}>
                  {image.label}
                </span>
              ))}
              {images.length === 0 ? (
                <span className="fine-print">Sin imágenes confirmadas.</span>
              ) : null}
            </div>
          </article>

          <article className="card" id="prod-voz">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Paso 3</p>
                <h3>Voz y narración</h3>
              </div>
              <span className="count-pill">{readyAudioCount}/{scenes.length} listas</span>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Voz</span>
                <select
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                  disabled={voices.length === 0 || busy}
                >
                  {voices.length === 0 ? <option value="">Sin voces detectadas</option> : null}
                  {voices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.culture}
                    </option>
                  ))}
                </select>
              </label>
              <p className="fine-print">
                Proveedor: {audioProviderKind === 'elevenlabs'
                  ? 'ElevenLabs (API oficial)'
                  : audioProviderKind === 'external-web'
                    ? 'web externa manual'
                    : 'Windows SAPI local'}
                {audioProviderKind === 'external-web'
                  ? '. Abrí la web en Ajustes, descargá los audios e importalos en Medios.'
                  : '. Configuralo en Ajustes → Audio y voz.'}
              </p>
              <label className="check production-check">
                <input
                  type="checkbox"
                  checked={generateMissingNarration}
                  onChange={(event) => setGenerateMissingNarration(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  Generar narración para las {needsSynthesis.length} escena(s) que no tienen audio
                </span>
              </label>
              <label className="check production-check">
                <input
                  type="checkbox"
                  checked={confirmVoice}
                  onChange={(event) => setConfirmVoice(event.target.checked)}
                  disabled={busy}
                />
                <span>Confirmo que tengo derechos sobre la voz y el audio de este proyecto.</span>
              </label>
            </div>
            <p className="fine-print">
              {unreadyAudio.length > 0
                ? `${unreadyAudio.length} escena(s) tienen audio sin derechos confirmados; al generar se marcan como permitidas.`
                : 'Las escenas con audio existente conservan su duración medida.'}
            </p>
          </article>

          <article className="card production-build-card" id="prod-montaje">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Paso 4</p>
                <h3>Montaje automático</h3>
              </div>
              {plan ? <span className="count-pill">Listo</span> : null}
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Asignación de imágenes</span>
                <select
                  value={assignment}
                  onChange={(event) => setAssignment(event.target.value as 'order' | 'match')}
                  disabled={busy}
                >
                  <option value="order">Orden original (001 → 002 → 003)</option>
                  <option value="match">Coincidir por prompt / nota visual</option>
                </select>
              </label>
              <label className="check production-check">
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(event) => setIncludeCaptions(event.target.checked)}
                  disabled={busy}
                />
                <span>Generar subtítulos desde la narración</span>
              </label>
              <label className="check production-check">
                <input
                  type="checkbox"
                  checked={replaceTimeline}
                  onChange={(event) => setReplaceTimeline(event.target.checked)}
                  disabled={busy}
                />
                <span>Reemplazar la timeline actual</span>
              </label>
              <label className="field">
                <span>Movimiento de las fotos</span>
                <select
                  value={photoMotion}
                  onChange={(event) => setPhotoMotion(event.target.value as 'auto' | 'none')}
                  disabled={busy}
                >
                  <option value="auto">Automático (zoom y paneo alternados)</option>
                  <option value="none">Sin movimiento</option>
                </select>
              </label>
              <label className="field">
                <span>Transición entre fotos (frames)</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  value={transitionFrames}
                  disabled={busy}
                  onChange={(event) =>
                    setTransitionFrames(
                      Math.max(0, Math.min(30, Math.round(Number(event.target.value) || 0))),
                    )
                  }
                />
              </label>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => void generateVideo()}
                disabled={!canGenerate}
              >
                {busy ? 'Generando video…' : 'Generar video automático'}
              </button>
              <button type="button" className="ghost" onClick={() => onNavigate('editor')}>
                Abrir editor
              </button>
            </div>
            {progress ? <p className="production-progress">{progress}</p> : null}
            {!canGenerate && !busy ? (
              <p className="fine-print">
                {scenes.length === 0
                  ? 'Faltan escenas de guion.'
                  : images.length === 0
                    ? 'Faltan imágenes confirmadas.'
                    : requiresVoiceRights && !confirmVoice
                      ? 'Confirmá los derechos de la voz para continuar.'
                      : needsSynthesis.length > 0 && !voice
                        ? 'Elegí una voz local.'
                        : 'Completá los pasos anteriores.'}
              </p>
            ) : null}
          </article>

          {warnings.length > 0 ? (
            <div className="notice notice-warning" role="status">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <article className="card" id="prod-revision">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Paso 5</p>
                <h3>Revisión y export</h3>
              </div>
              {plan ? <span className="count-pill">Timeline generada</span> : null}
            </div>
            {plan ? (
              <>
                <div className="production-result">
                  <div>
                    <strong>{plan.scenes.length} escenas</strong>
                    <span>{formatTimecode(plan.totalFrames, fps)}</span>
                  </div>
                  <div>
                    <strong>{plan.captionCount} subtítulos</strong>
                    <span>{plan.imagesUsed} imágenes usadas</span>
                  </div>
                  <div>
                    <strong>{plan.scenes.filter((scene) => scene.audioId).length} audios</strong>
                    <span>{plan.warnings.length} aviso(s)</span>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="primary" onClick={() => onNavigate('editor')}>
                    Abrir editor y revisar
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      store.requestExport();
                      onNavigate('editor');
                    }}
                  >
                    Abrir editor para exportar
                  </button>
                </div>
                <p className="fine-print">
                  El render sigue siendo explícito: elegí el perfil y el destino en Editor →
                  Exportar MP4. Editor IA no publica solo.
                </p>
              </>
            ) : (
              <p className="muted">
                Después del montaje vas a ver la duración, los subtítulos y los audios montados, y
                vas a poder abrir el editor para revisar y exportar.
              </p>
            )}
          </article>

          <PublicationReadiness />
        </div>
      </div>
    </section>
  );
}
