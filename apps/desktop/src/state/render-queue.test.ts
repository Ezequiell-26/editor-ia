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
  movePending,
  nextPending,
  queueEntryInScope,
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

const PROJECT = { id: 'proj-a', name: 'Proyecto A' };
const SCOPE_A = { projectId: PROJECT.id, profileIds: new Set(PROFILES.map((p) => p.id)) };

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
    const queue = enqueueProfiles([], PROFILES, true, PROJECT, new Date('2026-10-22T10:00:00Z'));
    expect(queue).toHaveLength(2);
    expect(queue.every((entry) => entry.status === 'pending')).toBe(true);
    expect(queue[0]?.profileName).toBe('Formato del proyecto 16:9');
    expect(queue[0]?.includeCaptions).toBe(true);
    expect(queue[0]?.queuedAt).toBe('2026-10-22T10:00:00.000Z');
  });

  it('no duplica un perfil que ya está pendiente o corriendo', () => {
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = enqueueProfiles(queue, [PROFILES[0]!], true, PROJECT);
    expect(queue).toHaveLength(2);
    queue = markRunning(queue, queue[0]!.id);
    queue = enqueueProfiles(queue, [PROFILES[0]!], true, PROJECT);
    expect(queue.filter((entry) => entry.profileId === 'p-16-9')).toHaveLength(1);
  });

  it('sí permite reencolar un perfil que ya terminó', () => {
    let queue = enqueueProfiles([], [PROFILES[0]!], true, PROJECT);
    queue = markRunning(queue, queue[0]!.id);
    queue = markDone(queue, queue[0]!.id, 'C:\\salida.mp4');
    queue = enqueueProfiles(queue, [PROFILES[0]!], true, PROJECT);
    expect(queue).toHaveLength(2);
    expect(queue[1]?.status).toBe('pending');
  });

  it('toma el primer pendiente y avanza el ciclo de vida', () => {
    let queue = enqueueProfiles([], PROFILES, false, PROJECT);
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
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = markRunning(queue, queue[0]!.id);
    queue = markFailed(queue, queue[0]!.id, 'sin disco');
    queue = retryEntry(queue, queue[0]!.id);
    expect(queue[0]).toMatchObject({ status: 'pending', message: null, outputPath: null });
    expect(nextPending(queue)?.id).toBe(queue[0]!.id);
  });

  it('quita una entrada y limpia las terminadas', () => {
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = markRunning(queue, queue[0]!.id);
    queue = markDone(queue, queue[0]!.id, 'C:\\uno.mp4');
    const removed = removeEntry(queue, queue[1]!.id);
    expect(removed).toHaveLength(1);
    expect(clearSettled(removed)).toHaveLength(0);
  });

  it('resume la cola con el detalle correcto', () => {
    const queue = enqueueProfiles([], PROFILES, true, PROJECT);
    const summary = summarizeQueue(queue);
    expect(summary).toEqual({ pending: 2, running: 0, done: 0, error: 0, cancelled: 0, total: 2 });
  });

  it('una entrada cancelada se reintenta y cuenta como saldada', () => {
    const memory = store();
    memory.setItem(
      'editor-ia.render-queue.v1',
      JSON.stringify([
        {
          id: 'c1',
          profileId: 'p-1',
          profileName: 'Uno',
          includeCaptions: false,
          status: 'cancelled',
          outputPath: null,
          message: null,
          queuedAt: '2026-10-22T10:00:00Z',
        },
      ]),
    );
    const loaded = loadRenderQueue(memory);
    expect(loaded[0]?.status).toBe('cancelled');
    const retried = retryEntry(loaded, 'c1');
    expect(retried[0]?.status).toBe('pending');
    expect(clearSettled(loaded)).toHaveLength(0);
    expect(summarizeQueue(loaded).cancelled).toBe(1);
  });

  it('persiste y recupera la cola', () => {
    const memory = store();
    let queue = enqueueProfiles([], PROFILES, true, PROJECT, new Date('2026-10-22T10:00:00Z'));
    saveRenderQueue(memory, queue);
    const loaded = loadRenderQueue(memory);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.profileId).toBe('p-16-9');
  });

  it('degrada un render interrumpido a pendiente al cargar', () => {
    const memory = store();
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
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
    const queue = enqueueProfiles([], many, true, PROJECT);
    expect(queue).toHaveLength(RENDER_QUEUE_LIMIT);
  });

  it('reordena pendientes sin tocar las entradas terminadas', () => {
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = markDone(queue, queue[1]!.id, 'C:\ya.mp4');
    const second = queue[0]!;
    const moved = movePending(queue, second.id, 'down');
    // La pendiente restante sigue primera en orden de pendientes.
    expect(nextPending(moved)?.profileId).toBe('p-16-9');
    // Sin otra pendiente, no hay a dónde moverla.
    expect(movePending(moved, second.id, 'down')).toBe(moved);
    expect(movePending(moved, second.id, 'up')).toBe(moved);
  });

  it('mueve una pendiente al frente del orden de drenaje', () => {
    let queue = enqueueProfiles([], [...PROFILES, { id: 'p-tercero', name: 'Tercero' }], true, PROJECT);
    const third = queue[2]!;
    const moved = movePending(queue, third.id, 'up');
    // Un lugar entre pendientes: queda segunda en el orden de drenaje.
    expect(nextPending(moved)?.id).toBe(queue[0]!.id);
    const front = movePending(moved, third.id, 'up');
    expect(nextPending(front)?.id).toBe(third.id);
    // Las posiciones de las entradas no pendientes quedan intactas.
    expect(moved.map((entry) => entry.id)).toEqual([queue[0]!.id, third.id, queue[1]!.id]);
  });

  it('genera nombres de archivo seguros', () => {
    expect(queueFileName('Mi Vídeo: Año 2026', 'Formato 16:9')).toBe('mi-video-ano-2026-formato-16-9.mp4');
    expect(queueFileName('...', '...')).toBe('proyecto-perfil.mp4');
    expect(queueFileName('Demo', 'Vertical', 'mov')).toBe('demo-vertical.mov');
  });

  it('las entradas recuerdan el proyecto que las encoló', () => {
    const queue = enqueueProfiles([], PROFILES, true, PROJECT);
    expect(queue[0]).toMatchObject({ projectId: 'proj-a', projectName: 'Proyecto A' });
  });

  it('el scope evita drenar pendientes de otro proyecto', () => {
    const projectB = { id: 'proj-b', name: 'Proyecto B' };
    const scopeB = { projectId: 'proj-b', profileIds: new Set(['pb-1']) };
    // Pendiente de A primero en la cola; el runner de B no debe tocarlo.
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = enqueueProfiles(queue, [{ id: 'pb-1', name: 'B 16:9' }], false, projectB);
    expect(nextPending(queue, scopeB)?.profileId).toBe('pb-1');
    // Y el de A sigue viendo los suyos, en orden.
    expect(nextPending(queue, SCOPE_A)?.profileId).toBe('p-16-9');
    expect(nextPending(queue, scopeB)?.id).not.toBe(nextPending(queue, SCOPE_A)?.id);
  });

  it('una entrada legacy sin proyecto se reclama sólo si el perfil existe en el scope', () => {
    const legacy = {
      id: 'leg-1',
      profileId: 'p-16-9',
      profileName: 'Viejo',
      includeCaptions: false,
      status: 'pending' as const,
      outputPath: null,
      message: null,
      queuedAt: '2026-10-01T00:00:00Z',
    };
    const foreignScope = { projectId: 'proj-x', profileIds: new Set(['otro-perfil']) };
    expect(nextPending([legacy], SCOPE_A)?.id).toBe('leg-1');
    expect(nextPending([legacy], foreignScope)).toBeNull();
    expect(queueEntryInScope(legacy, SCOPE_A)).toBe(true);
    expect(queueEntryInScope(legacy, foreignScope)).toBe(false);
  });

  it('reordenar con scope permuta sólo las pendientes del proyecto', () => {
    const projectB = { id: 'proj-b', name: 'Proyecto B' };
    const scopeB = { projectId: 'proj-b', profileIds: new Set(['pb-1', 'pb-2']) };
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = enqueueProfiles(
      queue,
      [
        { id: 'pb-1', name: 'B uno' },
        { id: 'pb-2', name: 'B dos' },
      ],
      false,
      projectB,
    );
    const secondB = queue.find((entry) => entry.profileId === 'pb-2')!;
    const moved = movePending(queue, secondB.id, 'up', scopeB);
    expect(nextPending(moved, scopeB)?.profileId).toBe('pb-2');
    // Las pendientes de A conservan su orden de drenaje.
    expect(nextPending(moved, SCOPE_A)?.profileId).toBe('p-16-9');
  });

  it('limpiar terminadas con scope conserva las entradas de otros proyectos', () => {
    const projectB = { id: 'proj-b', name: 'Proyecto B' };
    let queue = enqueueProfiles([], PROFILES, true, PROJECT);
    queue = enqueueProfiles(queue, [{ id: 'pb-1', name: 'B' }], false, projectB);
    // Termina una de A y otra de B; limpiar en A no toca la de B.
    queue = markDone(queue, queue[0]!.id, 'C:\\a.mp4');
    queue = markDone(queue, queue[2]!.id, 'C:\\b.mp4');
    const cleared = clearSettled(queue, SCOPE_A);
    expect(cleared).toHaveLength(2);
    expect(cleared.map((entry) => entry.profileId)).toEqual(['p-9-16', 'pb-1']);
    // La pendiente de B sigue ahí y la terminada de B también (saldada pero ajena).
    expect(cleared.find((entry) => entry.projectId === 'proj-b')).toMatchObject({
      profileId: 'pb-1',
      status: 'done',
    });
  });
});
