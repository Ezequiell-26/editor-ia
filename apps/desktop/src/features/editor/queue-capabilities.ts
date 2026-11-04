/**
 * Detección de capacidades de la cola de render en el backend actual.
 *
 * Pausar/reanudar/reordenar jobs requiere soporte del backend; si el servicio
 * no expone esos métodos, la UI no los inventa: los muestra deshabilitados con
 * el motivo. `detectQueueCapabilities` acepta el objeto servicio completo y
 * comprueba la presencia de las operaciones opcionales, de modo que cuando
 * workspace publique task-16 la UI se encienda sin cambiar el contrato de tipos
 * base (el servicio se amplía con esos métodos).
 */
export interface QueueCapabilities {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly reorder: boolean;
  readonly reason: string | null;
}

type QueueCapableService = {
  readonly pauseRender?: (jobId: string) => Promise<unknown>;
  readonly resumeRender?: (jobId: string) => Promise<unknown>;
  readonly moveRenderQueueEntry?: (jobId: string, direction: 'up' | 'down') => Promise<unknown>;
};

export function detectQueueCapabilities(service: unknown): QueueCapabilities {
  if (!service || typeof service !== 'object') {
    return { pause: false, resume: false, reorder: false, reason: 'el servicio no está disponible' };
  }
  const candidate = service as QueueCapableService;
  const pause = typeof candidate.pauseRender === 'function';
  const resume = typeof candidate.resumeRender === 'function';
  const reorder = typeof candidate.moveRenderQueueEntry === 'function';
  const missing: string[] = [];
  if (!pause) missing.push('pausa');
  if (!resume) missing.push('reanudar');
  if (!reorder) missing.push('reordenar');
  return {
    pause,
    resume,
    reorder,
    reason:
      missing.length === 0
        ? null
        : `la cola persistente del backend llega en una próxima fase (${missing.join('/')} no disponibles); no se simula`,
  };
}

/** Etiqueta corta para deshabilitar controles sin explicar de más en el botón. */
export function queueCapabilityTitle(capabilities: QueueCapabilities, action: 'pause' | 'resume' | 'reorder'): string {
  if (action === 'pause' && !capabilities.pause) return 'Pausa no soportada por el backend actual';
  if (action === 'resume' && !capabilities.resume) return 'Reanudar un job no soportado por el backend actual';
  if (action === 'reorder' && !capabilities.reorder) return 'Reordenar la cola no soportado por el backend actual';
  return '';
}
