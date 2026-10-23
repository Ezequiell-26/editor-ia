import type { PipelineProgress } from '../app/pipeline';
import type { ViewId } from '../app/navigation';

interface PipelineBarProps {
  readonly progress: PipelineProgress;
  readonly activeId: ViewId;
  readonly onSelect: (id: ViewId) => void;
}

/**
 * Franja fina con la ruta de producción.
 *
 * Muestra dónde está parado el proyecto y cuál es el paso siguiente. Es
 * deliberadamente baja —una sola línea— porque el editor necesita el alto para
 * la timeline; la explicación completa de cada paso vive en Inicio.
 */
export function PipelineBar({ progress, activeId, onSelect }: PipelineBarProps) {
  const next = progress.next;

  return (
    <nav className="pipeline-bar" aria-label="Ruta de producción">
      <span className="pipeline-title">
        <span className="pipeline-eyebrow">Ruta</span>
        <strong>
          {progress.complete
            ? 'completa'
            : `paso ${progress.currentIndex + 1} de ${progress.total}`}
        </strong>
      </span>

      <ol className="pipeline-steps">
        {progress.steps.map((step, index) => (
          <li key={step.stage.id} className="pipeline-step-item">
            <button
              type="button"
              className={`pipeline-step ${step.state}${activeId === step.stage.view ? ' active' : ''}`}
              aria-current={step.state === 'current' ? 'step' : undefined}
              aria-label={`${index + 1}. ${step.stage.label}: ${step.detail}`}
              data-tooltip={`${index + 1}. ${step.stage.label} · ${step.detail}`}
              onClick={() => onSelect(step.stage.view)}
            >
              <span className="pipeline-dot" aria-hidden="true">
                {step.state === 'done' ? '✓' : index + 1}
              </span>
              <span className="pipeline-label">{step.stage.label}</span>
            </button>
            {index < progress.steps.length - 1 && (
              <span className="pipeline-arrow" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="pipeline-actions">
        <span className="pipeline-percent" aria-hidden="true">
          {progress.percent}%
        </span>
        {next ? (
          <button
            type="button"
            className="primary pipeline-next"
            onClick={() => onSelect(next.view)}
          >
            Siguiente: {next.label}
          </button>
        ) : (
          <span className="pipeline-complete">Ruta completa</span>
        )}
      </div>
    </nav>
  );
}
