import { useMemo } from 'react';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { historyStepLabels } from '../../state/history-labels';
import { useProjectStore } from '../../state/project-store';

/**
 * Historial de deshacer con etiquetas legibles.
 *
 * El store guarda snapshots anónimos; las etiquetas se derivan comparando
 * estados consecutivos (`historyStepLabels`), igual que el panel de
 * historial de AlaukCut. Cada fila es un paso: pulsarla restaura ese punto
 * del proyecto y los pasos posteriores quedan disponibles para rehacer.
 */
export function HistoryDialog({ onClose }: { readonly onClose: () => void }) {
  const store = useProjectStore();
  const undo = store.state.undo;
  const project = store.state.project;

  const steps = useMemo(() => {
    if (!project) return [];
    const states = undo as readonly ProjectDocument[];
    const labels = historyStepLabels(states, project);
    // Más nuevo primero; `index` es la posición en la pila `undo`.
    return labels
      .map((label, index) => ({ index, label }))
      .reverse();
  }, [undo, project]);

  return (
    <div className="history-dialog">
      {!project ? (
        <p className="fine-print">Abrí un proyecto para ver su historial.</p>
      ) : steps.length === 0 ? (
        <p className="fine-print">Todavía no hay pasos para deshacer.</p>
      ) : (
        <>
          <p className="fine-print">
            {steps.length} paso{steps.length === 1 ? '' : 's'} · pulsá uno para volver a ese
            punto; lo posterior queda para rehacer.
          </p>
          <ol className="history-steps">
            <li className="history-step history-step-current" aria-current="true">
              <span className="history-step-label">Estado actual</span>
            </li>
            {steps.map(({ index, label }) => (
              <li key={index}>
                <button
                  type="button"
                  className="history-step"
                  onClick={() => {
                    store.undoTo(index);
                    onClose();
                  }}
                >
                  <span className="history-step-label">{label}</span>
                  <span className="fine-print">volver a este punto</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
