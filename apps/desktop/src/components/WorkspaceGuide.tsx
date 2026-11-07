import { useId } from 'react';
import type { ViewId } from '../app/navigation';
import type { PipelineProgress } from '../app/pipeline';
import {
  WORKSPACE_GROUPS,
  WORKSPACE_STEPS,
  WORKSPACE_STEP_COUNT,
  currentWorkspaceStep,
} from '../app/workspace-map';
import { Icon } from './Icon';

export interface WorkspaceGuideProps {
  readonly onNavigate: (id: ViewId) => void;
  /** Progreso real del proyecto; sin él la guía no inventa avances. */
  readonly progress?: PipelineProgress;
  /** Variante para el panel del editor: menos texto, misma ruta. */
  readonly compact?: boolean;
  readonly onOpenTour?: () => void;
  readonly onOpenShortcuts?: () => void;
  readonly currentView?: ViewId;
}

/**
 * ÚNICO componente de aprendizaje de la app. Se monta en LearnView (completo)
 * y en el modo «Guía» del editor (compacto), siempre con las mismas seis
 * etapas de `app/pipeline.ts`. Reemplaza los cuatro recorridos anteriores.
 */
export function WorkspaceGuide({
  onNavigate,
  progress,
  compact = false,
  onOpenTour,
  onOpenShortcuts,
  currentView,
}: WorkspaceGuideProps) {
  const titleId = useId();
  const next = progress ? currentWorkspaceStep(progress) : null;
  const doneCount = progress?.doneCount ?? 0;
  const percent = progress?.percent ?? 0;

  return (
    <section
      className={`workspace-guide${compact ? ' workspace-guide-compact' : ''}`}
      aria-labelledby={titleId}
    >
      <header className="learn-quick-head">
        <div>
          <p className="eyebrow">Ruta de producción</p>
          <h3 id={titleId}>
            De la idea al MP4 en {WORKSPACE_STEP_COUNT === 6 ? 'seis' : WORKSPACE_STEP_COUNT} pasos
          </h3>
          {!compact ? (
            <p className="muted">
              Un solo recorrido, el mismo en Inicio, en Aprender y dentro del editor.
              {next
                ? ` Tu próximo paso es ${next.label.toLowerCase()}.`
                : ' Las seis etapas están completas: podés volver a cualquiera.'}
            </p>
          ) : null}
        </div>
        {!compact ? (
          <button
            type="button"
            className="primary"
            onClick={() => onNavigate(next?.view ?? 'projects')}
          >
            {next ? `Continuar: ${next.label}` : 'Empezar ahora'}
          </button>
        ) : null}
      </header>

      {progress ? (
        <div
          className="pipeline-guide-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={WORKSPACE_STEP_COUNT}
          aria-valuenow={doneCount}
          aria-label="Progreso de la ruta de producción"
        >
          <div className="pipeline-guide-meter-track" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="fine-print">
            {doneCount} de {WORKSPACE_STEP_COUNT} etapas completas
          </span>
        </div>
      ) : null}

      <ol className="learn-steps">
        {WORKSPACE_STEPS.map((step, index) => {
          const state = progress?.steps[index]?.state;
          const isHere = currentView === step.view;
          return (
            <li
              key={step.id}
              className={`${state ? `is-${state}` : ''}${isHere ? ' is-here' : ''}`}
            >
              <span className="learn-step-number">
                <Icon name={step.icon} size={14} />
                <em>{String(index + 1).padStart(2, '0')}</em>
              </span>
              <div>
                <strong>{step.label}</strong>
                <p>{compact ? step.action : step.detail}</p>
                {!compact ? <p className="workspace-guide-tip">{step.tip}</p> : null}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onNavigate(step.view)}
                >
                  Ir a {step.label} →
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {/* El mapa también se muestra dentro del editor: es el mismo registro de
          4 grupos, presentado más denso. Así el modo Guía no deja medio panel
          vacío y refuerza «una app, un mapa». */}
      <div
        className={`workspace-guide-map${compact ? ' workspace-guide-map-compact' : ''}`}
        aria-label="Mapa del estudio"
      >
        <p className="eyebrow">Dónde está cada cosa</p>
        <div className="workspace-guide-groups">
          {WORKSPACE_GROUPS.map((group) => (
            <div key={group.id} className="workspace-guide-group">
              <strong>{group.label}</strong>
              {!compact ? <p>{group.hint}</p> : null}
              <span className="fine-print">{group.views.length} herramientas</span>
            </div>
          ))}
        </div>
      </div>

      {onOpenTour || onOpenShortcuts ? (
        <footer className="workspace-guide-actions">
          {onOpenTour ? (
            <button type="button" className="ghost small" onClick={onOpenTour}>
              Tour guiado
            </button>
          ) : null}
          {onOpenShortcuts ? (
            <button type="button" className="ghost small" onClick={onOpenShortcuts}>
              Atajos de teclado
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
