import type { ViewId } from '../../app/navigation';
import type { PipelineProgress } from '../../app/pipeline';
import { Icon } from '../../components/Icon';

interface PipelineGuideProps {
  readonly progress: PipelineProgress;
  readonly onNavigate: (id: ViewId) => void;
}

/**
 * La ruta completa, explicada. Vive en Inicio porque es lo primero que ve
 * alguien que abre la app sin saber por dónde empezar.
 */
export function PipelineGuide({ progress, onNavigate }: PipelineGuideProps) {
  const next = progress.next;

  return (
    <section className="card pipeline-guide" aria-labelledby="pipeline-guide-title">
      <header className="pipeline-guide-head">
        <div>
          <p className="eyebrow">Ruta de producción</p>
          <h2 id="pipeline-guide-title">De la idea al MP4 en seis pasos</h2>
          <p className="muted">
            {progress.complete
              ? 'Las seis etapas están completas. Podés volver a cualquiera para ajustar sin perder lo hecho.'
              : next
                ? `Vas por el paso ${progress.currentIndex + 1}: ${next.label}. Los pasos anteriores se pueden revisar y cambiar cuando quieras.`
                : 'Elegí por dónde seguir.'}
          </p>
        </div>
        {next ? (
          <button
            type="button"
            className="primary icon-text"
            onClick={() => onNavigate(next.view)}
          >
            <Icon name={next.icon} size={15} />
            <span>Ir a {next.label}</span>
          </button>
        ) : null}
      </header>

      <ol className="pipeline-guide-list">
        {progress.steps.map((step, index) => (
          <li key={step.stage.id} className={`pipeline-guide-step ${step.state}`}>
            <span className="pipeline-guide-index" aria-hidden="true">
              {step.state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}
            </span>
            <div className="pipeline-guide-copy">
              <strong>{step.stage.label}</strong>
              <p>{step.stage.action}</p>
              <small>{step.detail}</small>
            </div>
            <button
              type="button"
              className={step.state === 'current' ? 'ghost' : 'ghost small'}
              onClick={() => onNavigate(step.stage.view)}
              aria-label={`${step.state === 'done' ? 'Revisar' : 'Ir a'} ${step.stage.label}`}
            >
              {step.state === 'done' ? 'Revisar' : 'Ir'}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
