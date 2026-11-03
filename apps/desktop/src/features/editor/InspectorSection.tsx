import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';

/**
 * Sección del Inspector con jerarquía premium y plegado opcional (spec §8.5).
 *
 * Vive en su propio módulo porque la usan tanto el Inspector como las
 * subsecciones de audio (silencios, pausas, hablantes). Abierta por defecto:
 * el flujo de edición y los tests no cambian; el chevron permite plegar las
 * secciones largas. El estado de plegado es local y no se persiste.
 */
export function InspectorSection({
  title,
  children,
  group,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly group?: string | undefined;
  readonly className?: string | undefined;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      className={`inspector-section${className ? ` ${className}` : ''}${open ? '' : ' is-collapsed'}`}
      {...(group ? { 'data-group': group } : {})}
    >
      <h4>
        <button
          type="button"
          className="inspector-section-toggle"
          aria-expanded={open}
          title={open ? 'Contraer sección' : 'Expandir sección'}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{title}</span>
          <Icon name="chevron-down" size={12} />
        </button>
      </h4>
      {children}
    </section>
  );
}
