// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeService } from '../test/fake-service';
import { addTrack, ensureDelivery } from './project-actions';
import { ProjectProvider, useProjectStore } from './project-store';
import {
  RECOVERY_DEBOUNCE_MS,
  RECOVERY_STORAGE_KEY,
  clearRecoverySnapshot,
  createRecoveryWriter,
  readRecoverySnapshot,
  shouldOfferRecovery,
  writeRecoverySnapshot,
  type RecoverySnapshot,
  type RecoveryStorage,
} from './recovery';

const SAVED_AT = '2026-10-25T09:00:00.000Z';
const RECOVERY_PATH = 'C:\\tmp\\interrumpido.editoria.json';
const OPENED_PATH = 'C:\\tmp\\sin-guardar.editoria.json';

/** Almacenamiento en memoria con contador de escrituras, para las pruebas. */
function memoryStorage(overrides: Partial<RecoveryStorage> = {}): RecoveryStorage & {
  writes(): number;
} {
  const map = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    writes: () => writes,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('instantánea de recuperación', () => {
  it('guarda y lee la instantánea sin pérdida (ida y vuelta)', () => {
    const project = createEmptyProject('Carrera', '2025-01-01T00:00:00Z');
    expect(writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT)).toBe(true);

    const snapshot = readRecoverySnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.path).toBe(RECOVERY_PATH);
    expect(snapshot?.savedAt).toBe(SAVED_AT);
    expect(snapshot?.project).toEqual(project);
    expect(snapshot?.project.name).toBe('Carrera');

    clearRecoverySnapshot();
    expect(readRecoverySnapshot()).toBeNull();
  });

  it('respeta el almacenamiento inyectado y persiste solo {project, path, savedAt}', () => {
    const storage = memoryStorage();
    const project = createEmptyProject('Carrera', '2025-01-01T00:00:00Z');
    expect(writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT, storage)).toBe(true);
    expect(storage.writes()).toBe(1);

    const raw = JSON.parse(storage.getItem(RECOVERY_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    // Sin datos volátiles de la sesión: sin pid ni relojes de proceso.
    expect(Object.keys(raw).sort()).toEqual(['path', 'project', 'savedAt']);

    const snapshot = readRecoverySnapshot(storage);
    expect(snapshot?.path).toBe(RECOVERY_PATH);
    expect(snapshot?.savedAt).toBe(SAVED_AT);

    clearRecoverySnapshot(storage);
    expect(storage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('JSON corrupto o con forma inesperada: degrada a null sin lanzar', () => {
    const storage = memoryStorage();
    const cases = [
      '{no es json',
      'null',
      JSON.stringify({ otra: 'cosa' }),
      JSON.stringify({ project: null, path: RECOVERY_PATH, savedAt: SAVED_AT }),
      JSON.stringify({ project: {}, path: '', savedAt: SAVED_AT }),
      JSON.stringify({ project: {}, path: RECOVERY_PATH, savedAt: 'no-es-fecha' }),
    ];
    for (const broken of cases) {
      storage.setItem(RECOVERY_STORAGE_KEY, broken);
      expect(readRecoverySnapshot(storage)).toBeNull();
    }
  });

  it('cuota llena: escribir no lanza y degrada a false; leer sigue devolviendo null', () => {
    const project = createEmptyProject('Carrera', '2025-01-01T00:00:00Z');
    const quota = memoryStorage({
      setItem: () => {
        throw new DOMException('cuota llena', 'QuotaExceededError');
      },
    });
    expect(() =>
      writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT, quota),
    ).not.toThrow();
    expect(writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT, quota)).toBe(false);
    expect(readRecoverySnapshot(quota)).toBeNull();

    const lecturaRota = memoryStorage({
      getItem: () => {
        throw new Error('disco roto');
      },
    });
    expect(readRecoverySnapshot(lecturaRota)).toBeNull();
  });
});

describe('shouldOfferRecovery', () => {
  const base: RecoverySnapshot = {
    project: createEmptyProject('Carrera', '2025-01-01T00:00:00Z'),
    path: RECOVERY_PATH,
    savedAt: SAVED_AT,
  };

  it('ofrece solo si la instantánea es MÁS NUEVA que el último guardado conocido', () => {
    expect(shouldOfferRecovery(base, { savedAt: '2026-10-25T08:59:00.000Z' })).toBe(true);
    // Igualada no cuenta: solo estrictamente más nueva.
    expect(shouldOfferRecovery(base, { savedAt: SAVED_AT })).toBe(false);
    expect(shouldOfferRecovery(base, { savedAt: '2026-10-25T09:01:00.000Z' })).toBe(false);
  });

  it('sin guardado conocido ofrece; sin instantánea no ofrece nada', () => {
    expect(shouldOfferRecovery(base, null)).toBe(true);
    expect(shouldOfferRecovery(base, { savedAt: null })).toBe(true);
    expect(shouldOfferRecovery(null, null)).toBe(false);
    expect(shouldOfferRecovery(null, { savedAt: SAVED_AT })).toBe(false);
  });

  it('fechas inválidas no se ofrecen ni rompen la comparación', () => {
    expect(shouldOfferRecovery({ ...base, savedAt: 'no-es-fecha' }, { savedAt: null })).toBe(
      false,
    );
    expect(shouldOfferRecovery(base, { savedAt: 'no-es-fecha' })).toBe(true);
  });
});

describe('escritor con debounce', () => {
  it('agrupa una ráfaga de cambios en una sola escritura y sabe cancelarse', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
      const storage = memoryStorage();
      const writer = createRecoveryWriter({ storage });
      const a = createEmptyProject('Ráfaga A', '2025-01-01T00:00:00Z');
      const b = createEmptyProject('Ráfaga B', '2025-01-01T00:00:00Z');

      writer.schedule(a, 'C:\\tmp\\a.editoria.json');
      writer.schedule(b, 'C:\\tmp\\b.editoria.json');
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS - 1);
      expect(storage.writes()).toBe(0);
      vi.advanceTimersByTime(1);
      expect(storage.writes()).toBe(1);

      const snapshot = readRecoverySnapshot(storage);
      expect(snapshot?.path).toBe('C:\\tmp\\b.editoria.json');
      expect(snapshot?.project.name).toBe('Ráfaga B');
      expect(snapshot?.savedAt).toBe('2026-10-25T10:00:02.000Z');

      // Cancelar deja la escritura pendiente sin efecto.
      writer.schedule(a, 'C:\\tmp\\a.editoria.json');
      writer.cancel();
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS * 2);
      expect(storage.writes()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shouldWrite decide al vencer el temporizador si la escritura procede', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      let procede = false;
      const writer = createRecoveryWriter({ storage, shouldWrite: () => procede });
      const project = createEmptyProject('Carrera', '2025-01-01T00:00:00Z');

      writer.schedule(project, RECOVERY_PATH);
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS);
      expect(storage.writes()).toBe(0);

      procede = true;
      writer.schedule(project, RECOVERY_PATH);
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS);
      expect(storage.writes()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Sonda sin UI propia: expone el estado de recuperación que una tarjeta
 * futura consumiría y botones para accionarlo.
 */
function RecoveryProbe() {
  const store = useProjectStore();
  const offer = store.state.recoveryOffer;
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'oferta' }, offer ? offer.path : 'ninguna'),
    createElement('span', { 'data-testid': 'abierta' }, store.state.opened?.path ?? 'ninguna'),
    createElement('span', { 'data-testid': 'fase' }, store.state.phase),
    createElement(
      'button',
      { type: 'button', onClick: () => void store.acceptRecovery() },
      'aceptar',
    ),
    createElement(
      'button',
      { type: 'button', onClick: () => store.dismissRecovery() },
      'descartar',
    ),
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => {
          store.update((project) => addTrack(project, 'video').project);
        },
      },
      'editar',
    ),
  );
}

function openedOf(project: ProjectDocument, path: string) {
  return {
    project,
    label: 'sin-guardar.editoria.json',
    path,
    root: 'C:\\tmp',
  };
}

describe('cableado de recuperación en el store', () => {
  it('expone la oferta al montar y descartar limpia la instantánea', () => {
    const project = ensureDelivery(createEmptyProject('Interrumpido', '2025-01-01T00:00:00Z'));
    writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT);

    render(
      createElement(ProjectProvider, { service: createFakeService(), children: createElement(RecoveryProbe) }),
    );
    expect(screen.getByTestId('oferta').textContent).toBe(RECOVERY_PATH);

    fireEvent.click(screen.getByRole('button', { name: 'descartar' }));
    expect(screen.getByTestId('oferta').textContent).toBe('ninguna');
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('no ofrece recuperación sin instantánea previa', () => {
    render(
      createElement(ProjectProvider, { service: createFakeService(), children: createElement(RecoveryProbe) }),
    );
    expect(screen.getByTestId('oferta').textContent).toBe('ninguna');
  });

  it('aceptar reabre el archivo de la instantánea y limpia el registro', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Interrumpido', '2025-01-01T00:00:00Z'));
    writeRecoverySnapshot(project, RECOVERY_PATH, SAVED_AT);

    render(
      createElement(ProjectProvider, { service, children: createElement(RecoveryProbe) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'aceptar' }));
    await waitFor(() => {
      expect(screen.getByTestId('abierta').textContent).toBe(RECOVERY_PATH);
    });
    expect(screen.getByTestId('oferta').textContent).toBe('ninguna');
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('escribe la instantánea una vez tras la ráfaga de ediciones y la limpia al autoguardar', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
      // Autoguardado lento (8 s, el máximo permitido) para que el debounce de
      // recuperación de 2 s venza primero.
      window.localStorage.setItem(
        'editoria.editor-prefs.v1',
        JSON.stringify({ version: 1, autosaveDelayMs: 8_000 }),
      );
      const service = createFakeService();
      const project = ensureDelivery(createEmptyProject('Sin guardar', '2025-01-01T00:00:00Z'));
      const opened = openedOf(project, OPENED_PATH);
      service.current = opened;

      render(
        createElement(ProjectProvider, {
          service,
          initial: { project, opened },
          children: createElement(RecoveryProbe),
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'editar' }));
      fireEvent.click(screen.getByRole('button', { name: 'editar' }));

      await vi.advanceTimersByTimeAsync(RECOVERY_DEBOUNCE_MS);
      const snapshot = readRecoverySnapshot();
      expect(snapshot?.path).toBe(OPENED_PATH);
      expect(snapshot?.savedAt).toBe('2026-10-25T10:00:02.000Z');

      // El autoguardado (8 s) completa y limpia el registro: nada que recuperar.
      await vi.advanceTimersByTimeAsync(8_000);
      expect(service.calls.save).toBe(1);
      expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('con el autoguardado por defecto la instantánea no resucita tras guardar', async () => {
    vi.useFakeTimers();
    try {
      const service = createFakeService();
      const project = ensureDelivery(createEmptyProject('Guardado', '2025-01-01T00:00:00Z'));
      const opened = openedOf(project, OPENED_PATH);
      service.current = opened;

      render(
        createElement(ProjectProvider, {
          service,
          initial: { project, opened },
          children: createElement(RecoveryProbe),
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'editar' }));

      // El autoguardado (1,4 s) vence antes del debounce de recuperación (2 s):
      // al completarse, la escritura pendiente se cancela y el registro queda
      // vacío aunque se siga avanzando el reloj.
      await vi.advanceTimersByTimeAsync(RECOVERY_DEBOUNCE_MS * 3);
      expect(service.calls.save).toBe(1);
      expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
