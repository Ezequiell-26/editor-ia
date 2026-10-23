import { useEffect, useMemo, useState } from 'react';
import {
  computePipeline,
  isProjectExported,
  markProjectExported,
  pipelineSignals,
} from '../app/pipeline';
import { useProjectStore } from './project-store';

/**
 * Avance de la ruta de producción para el proyecto abierto.
 *
 * El estado de las etapas sale del propio documento; lo único que se persiste
 * aparte es “ya se exportó”, que se marca cuando el motor de render termina un
 * trabajo con estado `completed`.
 */
export function usePipeline() {
  const store = useProjectStore();
  const project = store.state.project;
  const projectId = project?.id ?? null;
  const [exported, setExported] = useState(() => isProjectExported(projectId));

  useEffect(() => {
    setExported(isProjectExported(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !store.service.available) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void store.service
      .onRenderFinished((event) => {
        if (event.status !== 'completed') return;
        if (markProjectExported(projectId)) setExported(true);
      })
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      .catch(() => {
        // Sin suscripción la ruta sigue funcionando con el estado del proyecto.
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [projectId, store.service]);

  return useMemo(() => computePipeline(pipelineSignals(project, exported)), [project, exported]);
}
