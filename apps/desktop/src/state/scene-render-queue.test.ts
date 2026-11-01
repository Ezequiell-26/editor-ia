// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EMPTY_RENDER_QUEUE,
  applyQueueAction,
  addQueueFinal,
  batchReadyForFinalize,
  enqueueScenes,
  loadRenderQueue,
  markQueueItemCompleted,
  markQueueItemFailed,
  markQueueItemRunning,
  nextQueuedItem,
  restoreRenderQueue,
  saveRenderQueue,
  type RenderQueueState,
} from './scene-render-queue';

function store(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const ROOT = 'C:\\trabajo\\proyecto';
const SCENES = [
  { id: 'scene-a', title: 'Apertura' },
  { id: 'scene-b', title: 'Cierre' },
];

describe('cola de escenas de render', () => {
  it('encola escenas y evita duplicar las que ya están activas', () => {
    const first = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: true,
    });
    expect(first.addedIds).toHaveLength(2);
    expect(first.state.items.map((item) => item.status)).toEqual(['queued', 'queued']);
    expect(first.state.items[0]?.sceneTitle).toBe('Apertura');
    expect(first.state.items[0]?.includeCaptions).toBe(true);
    const again = enqueueScenes(first.state, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: false,
    });
    expect(again.addedIds).toHaveLength(0);
    expect(again.state.items).toHaveLength(2);
  });

  it('permite reencolar una escena terminada y filtra por proyecto', () => {
    let state = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: [SCENES[0]!],
      includeCaptions: false,
    }).state;
    const id = state.items[0]!.id;
    state = markQueueItemRunning(state, id);
    state = markQueueItemCompleted(state, id, {
      outputPath: 'C:\\salida.mp4',
      bytes: 100,
      durationSeconds: 4,
    });
    expect(state.items[0]).toMatchObject({ status: 'completed', bytes: 100 });
    const other = enqueueScenes(state, {
      projectRoot: 'C:\\otro',
      scenes: [SCENES[0]!],
      includeCaptions: false,
    }).state;
    expect(nextQueuedItem(other, ROOT)).toBeNull();
    expect(nextQueuedItem(other, 'C:\\otro')?.sceneId).toBe('scene-a');
    const re = enqueueScenes(state, {
      projectRoot: ROOT,
      scenes: [SCENES[0]!],
      includeCaptions: false,
    });
    expect(re.addedIds).toHaveLength(1);
  });

  it('respeta la pausa y avanza el ciclo de vida', () => {
    let state = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: false,
    }).state;
    state = applyQueueAction(state, 'pause');
    expect(nextQueuedItem(state, ROOT)).toBeNull();
    state = applyQueueAction(state, 'resume');
    const item = nextQueuedItem(state, ROOT)!;
    state = markQueueItemRunning(state, item.id);
    expect(state.items[0]?.attempts).toBe(1);
    expect(nextQueuedItem(state, ROOT)?.sceneId).toBe('scene-b');
    state = markQueueItemFailed(state, item.id, 'ffmpeg falló');
    expect(state.items[0]).toMatchObject({ status: 'failed', error: 'ffmpeg falló' });
  });

  it('cancela sólo lo que sigue en cola y limpia terminados', () => {
    let state = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: false,
    }).state;
    state = markQueueItemRunning(state, state.items[0]!.id);
    const cancelled = applyQueueAction(state, 'cancel', state.items[0]!.id);
    expect(cancelled.items[0]?.status).toBe('running');
    const second = applyQueueAction(state, 'cancel', state.items[1]!.id);
    expect(second.items[1]?.status).toBe('cancelled');
    const cleared = applyQueueAction(second, 'clear-finished');
    expect(cleared.items.map((item) => item.status)).toEqual(['running']);
    const all = applyQueueAction(second, 'cancel');
    expect(all.paused).toBe(true);
    expect(all.items.find((item) => item.status === 'queued')).toBeUndefined();
  });

  it('marca un lote listo y registra el final concatenado', () => {
    let state = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: false,
      batchId: 'batch-1',
    }).state;
    expect(state.items.every((item) => item.batchId === 'batch-1')).toBe(true);
    expect(batchReadyForFinalize(state, 'batch-1')).toBeNull();
    for (const item of state.items) {
      state = markQueueItemRunning(state, item.id);
      state = markQueueItemCompleted(state, item.id, {
        outputPath: `C:\${item.sceneId}.mp4`,
        bytes: 10,
        durationSeconds: 2,
      });
    }
    expect(batchReadyForFinalize(state, 'batch-1')).toHaveLength(2);
    state = addQueueFinal(state, {
      batchId: 'batch-1',
      projectRoot: ROOT,
      outputPath: 'C:\final.mp4',
      bytes: 20,
      durationSeconds: 4,
      createdAt: '2026-10-31T00:00:00.000Z',
    });
    expect(state.finals).toHaveLength(1);
    expect(batchReadyForFinalize(state, 'batch-1')).toBeNull();
    const cleared = applyQueueAction(state, 'clear-finished');
    expect(cleared.finals).toHaveLength(0);
    const memory = store();
    saveRenderQueue(state, memory);
    expect(loadRenderQueue(memory).finals[0]?.outputPath).toBe('C:\final.mp4');
  });

  it('persiste y reanuda un trabajo interrumpido', () => {
    const memory = store();
    let state = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: [SCENES[0]!],
      includeCaptions: true,
    }).state;
    state = markQueueItemRunning(state, state.items[0]!.id);
    saveRenderQueue(state, memory);
    const loaded = loadRenderQueue(memory);
    expect(loaded.items[0]?.status).toBe('queued');
    expect(loaded.items[0]?.startedAt).toBeTruthy();
    expect(loaded.items[0]?.includeCaptions).toBe(true);
  });

  it('descarta JSON corrupto y entradas inválidas', () => {
    const mutating = store();
    mutating.setItem('olyvia.render.queue.v1', '{no es json');
    expect(loadRenderQueue(mutating)).toEqual(EMPTY_RENDER_QUEUE);
    const restored = restoreRenderQueue({
      version: 1,
      paused: 'sí',
      items: [
        null,
        { sceneId: 'x', projectRoot: ROOT, status: 'queued' },
        { sceneId: 'y', projectRoot: ROOT, status: 'inventado' },
        { sceneId: 'z', projectRoot: ROOT, status: 'running' },
      ],
    });
    expect(restored.paused).toBe(false);
    expect(restored.items).toHaveLength(2);
    expect(restored.items.map((item) => item.status)).toEqual(['queued', 'queued']);
  });

  it('el estado no se muta al aplicar acciones', () => {
    const state: RenderQueueState = enqueueScenes(EMPTY_RENDER_QUEUE, {
      projectRoot: ROOT,
      scenes: SCENES,
      includeCaptions: false,
    }).state;
    const frozen = JSON.stringify(state);
    applyQueueAction(state, 'pause');
    markQueueItemRunning(state, state.items[0]!.id);
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
