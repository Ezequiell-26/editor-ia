// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  RENDER_QUEUE_LIMIT,
  clearSettled,
  enqueueProfiles,
  loadRenderQueue,
  markDone,
  markFailed,
  markRunning,
  nextPending,
  queueFileName,
  removeEntry,
  retryEntry,
  saveRenderQueue,
  summarizeQueue,
  type KeyValueStore,
  type RenderQueue,
} from './render-queue';

const PROFILES = [
  { id: 'p-16-9', name: 'Formato del proyecto 16:9' },
  { id: 'p-9-16', name: 'Vertical 9:16' },
];

function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('cola de render', () => {
  it('encola perfiles con estado pendiente', () => {
    const queue = enqueueProfiles([], PROFILES, true, new Date('2026-10-22T10:00:00Z'));
    expect(queue).toHaveLength(2);
    expect(queue.every((entry) => entry.status === 'pending')).toBe(true);
    expect(queue[0]?.profileName).toBe('Formato del proyecto 16:9');
    expect(queue[0]?.includeCaptions).toBe(true);
    expect(queue[0]?.queuedAt).toBe('2026-10-22T10:00:00.000Z');
  });

  it('no duplica un perfil que ya está pendiente o corriendo', () => {
    let queue = enqueueProfiles([], PROFILES, true);
    queue = enqueueProfiles(queue, [PROFILES[0]!], true);
    expect(queue).toHaveLength(2);
    queue = markRunning(queue, queue[0]!.id);
    queue = enqueueProfiles(queue, [PROFILES[0]!], true);
    expect(queue.filter((entry) => entry.profileId === 'p-16-9')).toHaveLength(1);
  });

  it('sí permite reencolar un perfil que ya terminó', () => {
    let queue = enqueueProfiles([], [PROFILES[0]!], true);
    queue = markRunning(queue, queue[0]!.id);
    queue = markDone(queue, queue[0]!.id, 'C:\\salida.mp4');
    queue = enqueueProfiles(queue, [PROFILES[0]!], true);
    expect(queue).toHaveLength(2);
    expect(queue[1]?.status).toBe('pending');
  });

  it('toma el primer pendiente y avanza el ciclo de vida', () => {
    let queue = enqueueProfiles([], PROFILES, false);
    const first = nextPending(queue);
    expect(first?.profileId).toBe('p-16-9');
    queue = markRunning(queue, first!.id);
    expect(nextPending(queue)?.profileId).toBe('p-9-16');
    queue = markDone(queue, first!.id, 'C:\\uno.mp4');
    expect(queue[0]).toMatchObject({ status: 'done', outputPath: 'C:\\uno.mp4' });
    queue = markFailed(queue, nextPending(queue)!.id, 'ffmpeg salió con código 1');
    expect(queue[1]).toMatchObject({ status: 'error', message: 'ffmpeg salió con código 1' });
    expect(nextPending(queue)).toBeNull();
  });

  it('reintenta una entrada fallida conservando su posición', () => {
    let queue = enqueueProfiles([], PROFILES, true);
    queue = markRunning(queue, queue[0]!.id);
    queue = markFailed(queue, queue[0]!.id, 'sin disco');
    queue = retryEntry(queue, queue[0]!.id);
    expect(queue[0]).toMatchObject({ status: 'pending', message: null, outputPath: null });
    expect(nextPending(queue)?.id).toBe(queue[0]!.id);
  });

  it('quita una entrada y limpia las terminadas', () => {
    let queue = enqueueProfiles([], PROFILES, true);
    queue = markRunning(queue, queue[0]!.id);
    queue = markDone(queue, queue[0]!.id, 'C:\\uno.mp4');
    const removed = removeEntry(queue, queue[1]!.id);
    expect(removed).toHaveLength(1);
    expect(clearSettled(removed)).toHaveLength(0);
  });

  it('resume la cola con el detalle correcto', () => {
    const queue = enqueueProfiles([], PROFILES, true);
    const summary = summarizeQueue(queue);
    expect(summary).toEqual({ pending: 2, running: 0, done: 0, error: 0, total: 2 });
  });

  it('persiste y recupera la cola', () => {
    const memory = store();
    let queue = enqueueProfiles([], PROFILES, true, new Date('2026-10-22T10:00:00Z'));
    saveRenderQueue(memory, queue);
    const loaded = loadRenderQueue(memory);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.profileId).toBe('p-16-9');
  });

  it('degrada un render interrumpido a pendiente al cargar', () => {
    const memory = store();
    let queue = enqueueProfiles([], PROFILES, true);
    queue = markRunning(queue, queue[0]!.id);
    saveRenderQueue(memory, queue);
    const loaded = loadRenderQueue(memory);
    expect(loaded[0]?.status).toBe('pending');
    expect(loaded[0]?.outputPath).toBeNull();
  });

  it('sobrevive a JSON corrupto y entradas basura', () => {
    const memory = store();
    memory.setItem('editor-ia.render-queue.v1', '{no es json');
    expect(loadRenderQueue(memory)).toEqual([]);
    memory.setItem(
      'editor-ia.render-queue.v1',
      JSON.stringify([{ basura: true }, null, 42, { id: 'x', profileId: 'p', profileName: 'n', queuedAt: 'z', status: 'done' }]),
    );
    const loaded = loadRenderQueue(memory);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('x');
  });

  it('capea la cola al límite', () => {
    const many = Array.from({ length: RENDER_QUEUE_LIMIT + 12 }, (_, index) => ({
      id: `p-${index}`,
      name: `Perfil ${index}`,
    }));
    const queue = enqueueProfiles([], many, true);
    expect(queue).toHaveLength(RENDER_QUEUE_LIMIT);
  });

  it('genera nombres de archivo seguros', () => {
    expect(queueFileName('Mi Vídeo: Año 2026', 'Formato 16:9')).toBe('mi-video-ano-2026-formato-16-9.mp4');
    expect(queueFileName('...', '...')).toBe('proyecto-perfil.mp4');
    expect(queueFileName('Demo', 'Vertical', 'mov')).toBe('demo-vertical.mov');
  });
});
