import { Icon } from './Icon';

/** Pantalla de bloqueo para una herramienta que requiere Olyvia Pro. */
export function ProLock({
  feature,
  description,
  onOpenSettings,
}: {
  readonly feature: string;
  readonly description: string;
  readonly onOpenSettings?: () => void;
}) {
  return (
    <section className="view pro-lock" aria-label={`${feature} requiere Olyvia Pro`}>
      <span className="pro-lock-icon" aria-hidden="true">
        <Icon name="star" size={24} />
      </span>
      <p className="eyebrow">Olyvia Pro</p>
      <h2>{feature} es una herramienta Pro</h2>
      <p>{description}</p>
      <p className="fine-print">
        Free conserva el editor completo, la exportación 1080p y tus proyectos. Pro suma
        automatización, escala y herramientas de producción.
      </p>
      {onOpenSettings ? (
        <button type="button" className="primary" onClick={onOpenSettings}>
          Ver licencia en Ajustes
        </button>
      ) : null}
    </section>
  );
}
