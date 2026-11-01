const STEPS = ['Origen', 'Analizar', 'Opciones', 'Cola', 'Resultado'] as const;

/** Destino de scroll de cada paso del flujo de Ingesta. */
const TARGETS = [
  'ingest-source',
  'ingest-source',
  'ingest-options',
  'ingest-queue',
  'ingest-result',
] as const;

export interface IngestStepsProps {
  /** Paso activo, de 1 a 5. */
  readonly current: number;
  readonly hasResult: boolean;
}

/**
 * Tira de pasos de Ingesta. Es navegación real: cada paso lleva a su sección.
 * El último queda deshabilitado hasta que hay archivos de resultado.
 */
export function IngestSteps({ current, hasResult }: IngestStepsProps) {
  return (
    <nav className="ingest-steps" aria-label="Flujo de ingesta">
      {STEPS.map((label, index) => (
        <button
          key={label}
          type="button"
          className={`ingest-step${current === index + 1 ? ' active' : ''}${current > index + 1 ? ' done' : ''}`}
          aria-current={current === index + 1 ? 'step' : undefined}
          aria-label={`Ir al paso ${index + 1}`}
          disabled={index === 4 && !hasResult}
          onClick={() => {
            document
              .getElementById(TARGETS[index]!)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <b>{index + 1}</b>
          {label}
        </button>
      ))}
    </nav>
  );
}
