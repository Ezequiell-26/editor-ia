import { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/project-store';
import {
  applyCriticFixes,
  critiqueTimeline,
  type CriticSeverity,
} from '../../state/timeline-critic';

/**
 * Crítico de edición.
 *
 * Mide la timeline y muestra hallazgos con severidad. Sólo los que tienen un
 * arreglo seguro traen casilla; el resto son avisos para mirar. No cambia nada
 * hasta confirmar.
 */

const SEVERITY_LABEL: Record<CriticSeverity, string> = {
  error: 'grave',
  warn: 'aviso',
  info: 'nota',
};

export function CriticDialog({ onClose }: { readonly onClose: () => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const report = useMemo(() => (project ? critiqueTimeline(project) : null), [project]);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(report?.findings.filter((finding) => finding.fix).map((finding) => finding.id)),
  );

  function toggle(id: string): void {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply(): void {
    if (!project || !report) return;
    const next = applyCriticFixes(project, report.findings, accepted);
    const ok = store.update(() => next, {
      notice: `Crítica: ${accepted.size} arreglo(s) aplicados.`,
    });
    if (ok) onClose();
    else store.setNotice('La crítica no dejó el proyecto en un estado válido.');
  }

  if (!report) return <p className="fine-print">No hay proyecto abierto.</p>;

  return (
    <div className="review-dialog critic-dialog">
      <p className="fine-print">
        Puntaje medido: <strong>{report.score}/100</strong> · {report.findings.length} hallazgo(s) ·{' '}
        {report.fixable} con arreglo automático.
      </p>
      {report.findings.length === 0 ? (
        <p className="fine-print">
          No encontré problemas medibles: sin aire al inicio, sin huecos de audio, subtítulos a
          velocidad legible y volumen con objetivo.
        </p>
      ) : (
        <ul className="critic-list">
          {report.findings.map((finding) => (
            <li key={finding.id} className={`critic-item critic-${finding.severity}`}>
              <span className="critic-severity">{SEVERITY_LABEL[finding.severity]}</span>
              <div>
                <strong>{finding.title}</strong>
                <p className="fine-print">{finding.detail}</p>
              </div>
              {finding.fix ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={accepted.has(finding.id)}
                    aria-label={`Aplicar arreglo: ${finding.title}`}
                    onChange={() => toggle(finding.id)}
                  />
                  <span className="fine-print">arreglar</span>
                </label>
              ) : (
                <span className="fine-print">revisar</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="actions compact">
        <button type="button" className="small ghost" onClick={onClose}>
          Cerrar
        </button>
        <button
          type="button"
          className="small primary"
          disabled={accepted.size === 0}
          onClick={apply}
        >
          Aplicar {accepted.size} arreglo(s)
        </button>
      </footer>
    </div>
  );
}
