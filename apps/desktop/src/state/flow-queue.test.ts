import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOW_QUEUE_SETTINGS,
  EMPTY_FLOW_QUEUE,
  FLOW_QUEUE_STORAGE_KEY,
  createFlowQueue,
  finishFlowItem,
  flowQueueProgress,
  flowQueueStopReason,
  haltFlowQueue,
  loadFlowQueue,
  normalizeFlowQueueSettings,
  parseFlowPrompts,
  readFlowCredits,
  restoreFlowQueue,
  saveFlowQueue,
  takeNextItem,
  type FlowQueueSettings,
} from './flow-queue';

function settings(patch: Partial<FlowQueueSettings> = {}): FlowQueueSettings {
  return { ...DEFAULT_FLOW_QUEUE_SETTINGS, ...patch };
}

describe('cola de Flow', () => {
  it('lee prompts por línea, ignora comentarios y deduplica', () => {
    expect(
      parseFlowPrompts('un faro al atardecer\n\n# nota interna\nUn faro al atardecer\n  plano medio  \n'),
    ).toEqual(['un faro al atardecer', 'plano medio']);
    expect(parseFlowPrompts('   \n\n')).toEqual([]);
  });

  it('acota los ajustes fuera de rango', () => {
    const normalized = normalizeFlowQueueSettings({
      model: 'Midjourney',
      ratio: '21:9',
      imagesPerPrompt: 99,
      cooldownMs: -5,
      maxImages: 9_999,
      maxConsecutiveErrors: 0,
      repeatForever: 'sí',
    });
    expect(normalized.model).toBe(DEFAULT_FLOW_QUEUE_SETTINGS.model);
    expect(normalized.ratio).toBe(DEFAULT_FLOW_QUEUE_SETTINGS.ratio);
    expect(normalized.imagesPerPrompt).toBe(4);
    expect(normalized.cooldownMs).toBe(0);
    expect(normalized.maxImages).toBe(200);
    expect(normalized.maxConsecutiveErrors).toBe(1);
    expect(normalized.repeatForever).toBe(DEFAULT_FLOW_QUEUE_SETTINGS.repeatForever);
  });

  it('crea un ítem por repetición y los entrega en orden', () => {
    const queue = createFlowQueue(['a', 'b'], settings({ imagesPerPrompt: 2 }), 1_000);
    expect(queue.items).toHaveLength(4);
    expect(queue.items.map((item) => item.prompt)).toEqual(['a', 'a', 'b', 'b']);
    expect(queue.status).toBe('running');

    const first = takeNextItem(queue, 2_000);
    expect(first.item?.prompt).toBe('a');
    expect(first.state.items[0]?.status).toBe('running');
    expect(first.state.items[0]?.attempts).toBe(1);

    const second = takeNextItem(first.state, 3_000);
    expect(second.item?.id).toBe('flow-2');
  });

  it('acumula imágenes y corta por tope o por errores seguidos', () => {
    let queue = createFlowQueue(['a', 'b'], settings({ maxImages: 2 }), 0);
    const taken = takeNextItem(queue, 1);
    queue = finishFlowItem(taken.state, taken.item!.id, { ok: true, artifacts: ['x.png'] }, 2);
    expect(queue.imagesGenerated).toBe(1);
    // Queda un prompt pendiente: la corrida sigue.
    expect(flowQueueStopReason(queue)).toBeNull();

    const again = takeNextItem(queue, 3);
    queue = finishFlowItem(again.state, again.item!.id, { ok: true, artifacts: [] }, 4);
    // Sin rutas pero sin error: la generación ocurrió, cuenta como una imagen.
    expect(queue.imagesGenerated).toBe(2);
    expect(flowQueueStopReason(queue)).toContain('tope');

    let failing = createFlowQueue(['b', 'c'], settings({ maxConsecutiveErrors: 2 }), 0);
    const step1 = takeNextItem(failing, 1);
    failing = finishFlowItem(step1.state, step1.item!.id, { ok: false, error: 'sin sesión' }, 2);
    expect(failing.consecutiveErrors).toBe(1);
    expect(flowQueueStopReason(failing)).toBeNull();
    const step2 = takeNextItem(failing, 3);
    failing = finishFlowItem(step2.state, step2.item!.id, { ok: false, error: 'sin sesión' }, 4);
    expect(flowQueueStopReason(failing)).toContain('2 fallo');
  });

  it('termina cuando no quedan pendientes y no hay ciclo', () => {
    let queue = createFlowQueue(['único'], settings(), 0);
    const taken = takeNextItem(queue, 1);
    queue = finishFlowItem(taken.state, taken.item!.id, { ok: true, artifacts: ['a.png'] }, 2);
    expect(takeNextItem(queue, 3).item).toBeNull();
    expect(flowQueueStopReason(queue)).toContain('lista');
  });

  it('recicla los completados cuando la corrida es continua', () => {
    let queue = createFlowQueue(['a'], settings({ repeatForever: true, maxImages: 5 }), 0);
    const taken = takeNextItem(queue, 1);
    queue = finishFlowItem(taken.state, taken.item!.id, { ok: true, artifacts: ['a.png'] }, 2);

    const next = takeNextItem(queue, 3);
    expect(next.item?.id).toBe('flow-1');
    expect(next.state.cycles).toBe(1);
    expect(next.state.items[0]?.artifacts).toEqual([]);
    // Los fallidos no se reciclan.
    const failed = finishFlowItem(next.state, 'flow-1', { ok: false, error: 'boom' }, 4);
    expect(takeNextItem(failed, 5).item).toBeNull();
  });

  it('resume el avance para la interfaz', () => {
    let queue = createFlowQueue(['a', 'b'], settings(), 0);
    const taken = takeNextItem(queue, 1);
    queue = finishFlowItem(taken.state, taken.item!.id, { ok: true, artifacts: ['a.png'] }, 2);
    const progress = flowQueueProgress(queue);
    expect(progress).toMatchObject({ total: 2, done: 1, failed: 0, pending: 1, images: 1 });
    expect(progress.runningPrompt).toBeNull();
  });

  it('marca la corrida como detenida con su motivo', () => {
    const queue = haltFlowQueue(createFlowQueue(['a'], settings(), 0), 'Detenido por el usuario.');
    expect(queue.status).toBe('stopped');
    expect(flowQueueStopReason(queue)).toBe('Detenido por el usuario.');
  });

  it('lee el saldo de créditos y no inventa si no lo encuentra', () => {
    expect(readFlowCredits({ credits: 120 })).toBe(120);
    expect(readFlowCredits('Remaining credits: 1.5')).toBe(1.5);
    expect(readFlowCredits('Session active, no balance')).toBeNull();
    expect(readFlowCredits(null)).toBeNull();
  });

  it('guarda el plan y lo recupera sin reanudar solo', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    let queue = createFlowQueue(['a', 'b'], settings({ imagesPerPrompt: 1 }), 0);
    const taken = takeNextItem(queue, 1);
    queue = finishFlowItem(taken.state, taken.item!.id, { ok: true, artifacts: ['a.png'] }, 2);

    saveFlowQueue(queue, adapter);
    expect(storage.has(FLOW_QUEUE_STORAGE_KEY)).toBe(true);

    const restored = loadFlowQueue(adapter);
    expect(restored.items).toHaveLength(2);
    expect(restored.items[0]?.status).toBe('done');
    expect(restored.imagesGenerated).toBe(1);
    // Recuperar nunca reanuda: hace falta autorización explícita.
    expect(restored.status).toBe('stopped');
    expect(restored.stopReason).toContain('autorización');
  });

  it('tolera un guardado corrupto y descarta ítems sin prompt', () => {
    expect(restoreFlowQueue({ items: [{ prompt: '' }, { prompt: 'válido' }] }).items).toHaveLength(1);
    expect(restoreFlowQueue(null)).toEqual(EMPTY_FLOW_QUEUE);
    expect(loadFlowQueue({ getItem: () => '{roto' })).toEqual(EMPTY_FLOW_QUEUE);
  });

  it('devuelve un ítem en curso a pendiente al restaurar', () => {
    const restored = restoreFlowQueue({
      items: [{ id: 'x', prompt: 'p', status: 'running' }],
    });
    expect(restored.items[0]?.status).toBe('pending');
  });
});
