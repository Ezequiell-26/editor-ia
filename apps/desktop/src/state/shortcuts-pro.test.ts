// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandPalette } from '../components/CommandPalette';
import { NAV_VIEWS } from '../app/navigation';
import { Timeline } from '../features/editor/Timeline';
import { createFakeService } from '../test/fake-service';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  SHORTCUT_LABELS,
  normalizeBinding,
  type ShortcutId,
} from './shortcuts';
import {
  duplicateClip,
  ensureDelivery,
  moveClip,
  rippleDeleteClip,
  splitClip,
  totalFrames,
  trimClip,
} from './project-actions';
import { addMarker, deleteMarker, markerAtFrame } from './markers';
import { ProjectProvider, useProjectStore, type ProjectStoreValue } from './project-store';

/**
 * Validación del registro de atajos "pro" (docs/ATAJOS-PRO.md):
 *  1. estructura válida del registro (las tres tablas cubren los mismos ids);
 *  2. ninguna tecla duplicada en el mapa de defaults;
 *  3. cada atajo apunta a una acción que existe de verdad (importa el registro
 *     real y los módulos que implementan las acciones, nada copiado a mano).
 */

// ---------------------------------------------------------------------------
// Sonda: lee el store real montando el proveedor, para probar que las acciones
// de reproducción/edición (setPlaying, setPlayhead, setSelection, undo…) existen
// en runtime y no sólo en la interfaz de tipos.
// ---------------------------------------------------------------------------

let sondaStore: ProjectStoreValue | null = null;

function Sonda(): null {
  sondaStore = useProjectStore();
  return null;
}

function capturarStore(): ProjectStoreValue {
  const project = ensureDelivery(
    createEmptyProject('Proyecto de atajos', '2026-01-01T00:00:00Z'),
  );
  render(
    createElement(ProjectProvider, {
      service: createFakeService(),
      initial: { project },
      children: createElement(Sonda),
    }),
  );
  if (!sondaStore) {
    throw new Error('la sonda no pudo leer el store del proyecto');
  }
  return sondaStore;
}

afterEach(() => {
  cleanup();
  sondaStore = null;
});

/**
 * Evidencia de cada acción del registro. Para acciones de documento son las
 * funciones reales de project-actions / markers; para acciones del store son
 * los métodos capturados en runtime; para las de UI (paleta, zoom de timeline)
 * es el componente que las implementa (botones en Timeline.tsx:1184-1206).
 */
function construirEvidencia(store: ProjectStoreValue): Record<string, readonly unknown[]> {
  return {
    'palette.toggle': [CommandPalette],
    'nav.home': vistaDe('home'),
    'nav.editor': vistaDe('editor'),
    'nav.script': vistaDe('script'),
    'nav.assets': vistaDe('assets'),
    'nav.production': vistaDe('production'),
    'nav.factory': vistaDe('factory'),
    'nav.director': vistaDe('director'),
    'nav.download': vistaDe('download'),
    'nav.settings': vistaDe('settings'),
    'file.save': [store.saveNow],
    'file.saveAs': [store.saveAs],
    'file.open': [store.openProject],
    'file.export': [store.requestExport],
    'edit.undo': [store.undo],
    'edit.redo': [store.redo],
    'edit.duplicateClip': [duplicateClip, store.mutate],
    'edit.rippleDelete': [rippleDeleteClip, store.update],
    'edit.deselect': [store.setSelection],
    'playback.playPause': [store.setPlaying],
    'playback.shuttleForward': [store.setPlaying],
    'playback.shuttlePause': [store.setPlaying],
    'playback.framePrev': [store.setPlayhead],
    'playback.frameNext': [store.setPlayhead],
    'playback.goToStart': [store.setPlayhead],
    'playback.goToEnd': [store.setPlayhead, totalFrames],
    'timeline.splitAtPlayhead': [splitClip, store.mutate],
    'timeline.toggleMarker': [addMarker, deleteMarker, markerAtFrame, store.update],
    'timeline.trimIn': [trimClip, store.update],
    'timeline.trimOut': [trimClip, store.update],
    'timeline.zoomIn': [Timeline],
    'timeline.zoomOut': [Timeline],
    'timeline.zoomFit': [Timeline],
    // Edición de clip por teclado (fase 2 de accesibilidad): operan vía el
    // handler de EditorWorkspace.tsx con las mismas acciones de dominio.
    'timeline.clipMoveLeft': [moveClip, store.update],
    'timeline.clipMoveRight': [moveClip, store.update],
    'timeline.clipMoveTrackUp': [moveClip, store.update],
    'timeline.clipMoveTrackDown': [moveClip, store.update],
    'timeline.clipTrimIn': [trimClip, store.update],
    'timeline.clipTrimOut': [trimClip, store.update],
  };
}

/**NAV_VIEWS real: la vista destino de un atajo nav.* tiene que existir. */
function vistaDe(id: string): readonly unknown[] {
  const vista = NAV_VIEWS.find((item) => item.id === id);
  if (!vista) {
    throw new Error(`la vista "${id}" no existe en NAV_VIEWS`);
  }
  return [vista];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('atajos pro (registro de teclado)', () => {
  it('el registro tiene estructura válida: tres tablas alineadas y formas canónicas', () => {
    const ids = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[];
    expect(ids.length).toBeGreaterThan(0);
    // Las tres tablas cubren exactamente los mismos ids: ningún atajo sin
    // etiqueta, sin categoría o sin tecla por defecto.
    expect(new Set(Object.keys(SHORTCUT_LABELS))).toEqual(new Set(ids));
    expect(new Set(Object.keys(SHORTCUT_CATEGORIES))).toEqual(new Set(ids));
    for (const id of ids) {
      const binding = DEFAULT_SHORTCUTS[id];
      expect(typeof binding, `tecla de ${id} no es texto`).toBe('string');
      expect(binding.trim().length, `tecla de ${id} vacía`).toBeGreaterThan(0);
      // Forma canónica: lo guardado ya está normalizado (Ctrl antes de Shift,
      // letras mayúsculas), igual que lo que produce eventToBinding.
      expect(normalizeBinding(binding), `tecla de ${id} no canónica`).toBe(binding);
      expect(SHORTCUT_LABELS[id].trim(), `etiqueta de ${id} vacía`).toBeTruthy();
      expect(SHORTCUT_CATEGORIES[id].trim(), `categoría de ${id} vacía`).toBeTruthy();
    }
  });

  it('ninguna tecla está duplicada en el mapa de defaults', () => {
    const usadas = new Map<string, ShortcutId>();
    for (const [id, binding] of Object.entries(DEFAULT_SHORTCUTS) as [ShortcutId, string][]) {
      const clave = normalizeBinding(binding);
      const dueno = usadas.get(clave);
      expect(dueno, `"${binding}" ya lo usa "${dueno ?? '??'}" y también "${id}"`).toBeUndefined();
      usadas.set(clave, id);
    }
  });

  it('cada atajo del registro apunta a una acción que existe de verdad', () => {
    const store = capturarStore();
    const evidencia = construirEvidencia(store);
    const ids = Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[];

    // Cobertura exacta: todo id del registro tiene evidencia y la tabla no
    // menciona ids inventados. Un atajo nuevo sin acción real rompe este test.
    const idsEnTabla = new Set(Object.keys(evidencia));
    for (const id of ids) {
      expect(idsEnTabla.has(id), `el atajo "${id}" no tiene evidencia de acción`).toBe(true);
    }
    for (const id of idsEnTabla) {
      expect(
        id in DEFAULT_SHORTCUTS,
        `la evidencia menciona un id que no está en el registro: ${id}`,
      ).toBe(true);
    }

    for (const id of ids) {
      for (const simbolo of evidencia[id] ?? []) {
        // Funciones para las acciones; objetos reales para las vistas de nav.*
        // (la entrada de NAV_VIEWS que prueba que el destino existe).
        expect(
          ['function', 'object'].includes(typeof simbolo),
          `la acción de "${id}" no existe en runtime`,
        ).toBe(true);
      }
    }
  });

  it('los atajos pro están registrados con la tecla acordada', () => {
    const esperados: readonly (readonly [ShortcutId, string])[] = [
      ['playback.shuttleForward', 'L'],
      ['playback.shuttlePause', 'K'],
      ['playback.framePrev', ','],
      ['playback.frameNext', '.'],
      ['playback.goToStart', 'Home'],
      ['playback.goToEnd', 'End'],
      ['timeline.splitAtPlayhead', 'S'],
      ['timeline.toggleMarker', 'M'],
      ['timeline.trimIn', '['],
      ['timeline.trimOut', ']'],
      ['timeline.zoomIn', '+'],
      ['timeline.zoomOut', '-'],
      ['timeline.zoomFit', 'F'],
    ];
    for (const [id, tecla] of esperados) {
      expect(DEFAULT_SHORTCUTS[id], `falta el atajo pro "${id}"`).toBe(tecla);
    }
    // J no se registra: el motor de reproducción no soporta ir hacia atrás
    // (usePlayback sólo avanza). Pendiente en docs/ATAJOS-PRO.md.
    expect(Object.values(DEFAULT_SHORTCUTS)).not.toContain('J');
  });

  it('no reasigna atajos existentes: Ctrl+D sigue siendo duplicar y el ripple mantiene su tecla', () => {
    expect(DEFAULT_SHORTCUTS['edit.duplicateClip']).toBe('Ctrl+D');
    expect(DEFAULT_SHORTCUTS['edit.rippleDelete']).toBe('Ctrl+Shift+Delete');
    expect(DEFAULT_SHORTCUTS['playback.playPause']).toBe('Space');
    expect(DEFAULT_SHORTCUTS['file.save']).toBe('Ctrl+S');
  });
});
