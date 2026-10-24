import { useState } from 'react';
import type { Clip, MotionItem } from '@editor-ia/project-schema';
import { updateMotionProps } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { MotionForm } from './MotionForm';
import { templateById } from './templates';

export function MotionClipInspector({
  clip,
  motion,
}: {
  readonly clip: Extract<Clip, { kind: 'graphic' }>;
  readonly motion: MotionItem;
}) {
  const store = useProjectStore();
  const template = templateById(motion.template.id);
  const [error, setError] = useState<string | null>(null);

  if (!template) {
    return (
      <p className="notice notice-warning" role="alert">
        La plantilla {motion.template.id} ya no está disponible.
      </p>
    );
  }

  function change(next: Record<string, unknown>): void {
    const parsed = template!.propsSchema.safeParse(next);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first ? `${first.path.join('.')}: ${first.message}` : 'props inválidas');
      return;
    }
    try {
      store.mutate((current) => ({
        project: updateMotionProps(
          current,
          motion.id,
          parsed.data as Record<string, unknown>,
        ),
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudieron guardar las props');
    }
  }

  return (
    <div className="motion-clip-inspector">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Gráfico</p>
          <h4>{template.label}</h4>
        </div>
        <span className="count-pill">v{template.version}</span>
      </div>
      <p className="fine-print">
        {clip.label ?? 'Clip gráfico'} · se quema al exportar. La preview es representativa.
      </p>
      <MotionForm template={template} props={motion.props} onChange={change} />
      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
