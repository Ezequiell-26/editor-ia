import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { addMotionGraphic } from '../../state/project-actions';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { LottiePanel } from './LottiePanel';
import { MotionForm } from './MotionForm';
import { MotionPreview } from './MotionPreview';
import { buildMotionPlan, MOTION_TEMPLATES } from './plan';
import type { MotionPlan, MotionTemplate } from './templates';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo preparar el gráfico';
}

export function MotionView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const [templateId, setTemplateId] = useState(MOTION_TEMPLATES[0]!.id);
  const template = MOTION_TEMPLATES.find((item) => item.id === templateId) ?? MOTION_TEMPLATES[0]!;
  const [props, setProps] = useState<Record<string, unknown>>(() => ({
    ...MOTION_TEMPLATES[0]!.defaults,
  }));
  const [durationSeconds, setDurationSeconds] = useState(3);
  const [previewProgress, setPreviewProgress] = useState(0.45);
  const [brief, setBrief] = useState<string | null>(null);
  const [aiBrief, setAiBrief] = useState('');
  const [aiConsent, setAiConsent] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('editoria.motion.brief');
      if (stored?.trim()) {
        setBrief(stored.trim());
        setAiBrief(stored.trim());
      }
    } catch {
      setBrief(null);
    }
  }, []);

  const fps = project ? fpsOf(project) : 30;
  const durationFrames = Math.max(1, Math.round(durationSeconds * fps));
  const context = {
    width: project?.video.width ?? 1920,
    height: project?.video.height ?? 1080,
    fpsNum: project?.video.frameRate.num ?? 30,
    fpsDen: project?.video.frameRate.den ?? 1,
    durationFrames,
  };

  const built = useMemo(() => {
    try {
      return { plan: buildMotionPlan(template, props, context), error: null as string | null };
    } catch (error) {
      return { plan: null as MotionPlan | null, error: messageOf(error) };
    }
  }, [template, props, context.width, context.height, context.fpsNum, context.fpsDen, durationFrames]);

  function pick(next: MotionTemplate): void {
    setTemplateId(next.id);
    setProps({ ...next.defaults });
    setPreviewProgress(0.45);
  }

  async function generateWithAi(): Promise<void> {
    const clean = aiBrief.trim();
    if (clean.length < 10) {
      setAiError('Escribí un brief de al menos 10 caracteres.');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiFeedback(null);
    try {
      const suggestion = await store.service.generateMotion({
        brief: clean,
        templateId: template.id,
        approvedCost: aiConsent,
      });
      setProps({ ...template.defaults, ...suggestion.props });
      setPreviewProgress(0.45);
      setAiFeedback(
        `${suggestion.simulated ? 'Sugerencia simulada' : `Sugerencia de ${suggestion.model}`}. Revisá la preview y pulsá Agregar a la timeline.`,
      );
    } catch (error) {
      setAiError(messageOf(error));
    } finally {
      setAiBusy(false);
    }
  }

  function addToTimeline(): void {
    if (!project) {
      store.setNotice('Abrí o creá un proyecto antes de agregar un gráfico.');
      return;
    }
    if (!built.plan) {
      store.setNotice(built.error ?? 'las props del gráfico no son válidas');
      return;
    }
    let clipId: string | null = null;
    const ok = store.mutate(
      (current) => {
        const added = addMotionGraphic(current, {
          templateId: template.id,
          templateVersion: template.version,
          props,
          durationFrames,
          atFrame: store.state.playheadFrame,
          label: template.label,
        });
        clipId = added.clipId;
        return { project: added.project };
      },
      { notice: `Gráfico agregado: ${template.label}.` },
    );
    if (!ok || !clipId) {
      store.setNotice('El gráfico no deja el proyecto en un estado válido.');
      return;
    }
    store.setSelection({ kind: 'clip', id: clipId });
    onNavigate('editor');
  }

  return (
    <section className="view compress-view motion-view">
      <ViewToolbar
        label="Motion"
        actions={
          <span className="fine-print">
            <Icon name="motion" size={13} /> Render local · ASS/FFmpeg
          </span>
        }
      />

      <header className="compress-head">
        <div>
          <h2>Motion graphics</h2>
          <p>
            Elegí una plantilla, ajustá el texto y el acento, y agregala a la timeline.
            La preview es representativa; el render final lo hace FFmpeg.
          </p>
        </div>
      </header>

      {brief ? (
        <p className="notice" role="status">
          Brief del AI Hub: {brief}
        </p>
      ) : null}

      <div className="card motion-ai">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Asistente</p>
            <h3>Generar props con IA</h3>
          </div>
          <span className="fine-print">
            {template.label} · salida validada antes de aplicar
          </span>
        </div>
        <textarea
          value={aiBrief}
          onChange={(event) => setAiBrief(event.target.value)}
          rows={2}
          maxLength={500}
          aria-label="Brief para Motion"
          placeholder="Ej.: un cierre para un tutorial de cocina, tono cálido y directo"
        />
        <label className="check">
          <input
            type="checkbox"
            checked={aiConsent}
            onChange={(event) => setAiConsent(event.target.checked)}
          />
          <span>Autorizo una posible llamada de pago si el proveedor es remoto.</span>
        </label>
        <div className="actions compact">
          <button
            type="button"
            className="ghost"
            disabled={aiBusy || aiBrief.trim().length < 10}
            onClick={() => void generateWithAi()}
          >
            {aiBusy ? 'Generando…' : 'Generar con IA'}
          </button>
          {aiFeedback ? <span className="fine-print">{aiFeedback}</span> : null}
        </div>
        {aiError ? (
          <p className="notice notice-warning" role="alert">
            {aiError}
          </p>
        ) : null}
      </div>

      <LottiePanel onNavigate={onNavigate} />

      <div className="motion-layout">
        <aside className="motion-gallery" aria-label="Plantillas de motion">
          {MOTION_TEMPLATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`motion-template${item.id === template.id ? ' active' : ''}`}
              aria-pressed={item.id === template.id}
              onClick={() => pick(item)}
            >
              <span className="motion-template-category">{item.category}</span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </aside>

        <div className="motion-stage">
          <div className="motion-preview-frame">
            {built.plan ? (
              <MotionPreview plan={built.plan} progress={previewProgress} />
            ) : (
              <div className="graphic-placeholder">{built.error}</div>
            )}
          </div>
          <label className="motion-range">
            <span>Momento de la preview</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={previewProgress}
              onChange={(event) => setPreviewProgress(Number(event.target.value))}
            />
          </label>
          <label className="motion-duration">
            <span>Duración (segundos)</span>
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={durationSeconds}
              onChange={(event) =>
                setDurationSeconds(Math.min(30, Math.max(1, Number(event.target.value) || 1)))
              }
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!project || !built.plan}
            onClick={addToTimeline}
          >
            Agregar a la timeline
          </button>
          {!project ? (
            <p className="fine-print">Abrí o creá un proyecto para montar el gráfico.</p>
          ) : null}
          {built.error ? (
            <p className="notice notice-warning" role="alert">
              {built.error}
            </p>
          ) : null}
        </div>

        <div className="motion-form-panel">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">{template.category}</p>
              <h3>{template.label}</h3>
            </div>
            <span className="count-pill">v{template.version}</span>
          </div>
          <MotionForm template={template} props={props} onChange={setProps} />
          <p className="fine-print">
            Se agrega como clip gráfico en una pista G. Podés editar las props después
            desde el Inspector.
          </p>
        </div>
      </div>
    </section>
  );
}
