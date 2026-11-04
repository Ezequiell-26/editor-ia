// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_CHANGED_EVENT,
  SHORTCUTS_STORAGE_KEY,
  assignShortcut,
  findShortcutConflict,
  getShortcut,
  loadShortcuts,
  resetShortcuts,
  saveShortcuts,
  shortcutOverrides,
  type ShortcutMap,
} from './shortcuts';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

function storedOverrides(): Record<string, string> | null {
  const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, string>) : null;
}

describe('persistencia de atajos configurables', () => {
  it('sin nada guardado devuelve los defaults de fábrica', () => {
    expect(loadShortcuts()).toEqual(DEFAULT_SHORTCUTS);
    expect(storedOverrides()).toBeNull();
  });

  it('guarda sólo los overrides y recompone el resto con los defaults', () => {
    const map: ShortcutMap = { ...DEFAULT_SHORTCUTS, 'file.save': 'Ctrl+Alt+S' };
    saveShortcuts(map);

    // Si se persistiera el mapa completo, un default nuevo nunca llegaría a
    // quien no lo personalizó: sólo debe viajar lo distinto.
    expect(storedOverrides()).toEqual({ 'file.save': 'Ctrl+Alt+S' });
    expect(loadShortcuts()).toEqual(map);
  });

  it('normaliza el binding antes de persistirlo', () => {
    saveShortcuts({ ...DEFAULT_SHORTCUTS, 'edit.undo': 'ctrl+alt+z' });
    expect(storedOverrides()).toEqual({ 'edit.undo': 'Ctrl+Alt+Z' });
    expect(loadShortcuts()['edit.undo']).toBe('Ctrl+Alt+Z');
  });

  it('shortcutOverrides no incluye los atajos que siguen en su default', () => {
    expect(shortcutOverrides(DEFAULT_SHORTCUTS)).toEqual({});
    expect(
      shortcutOverrides({
        ...DEFAULT_SHORTCUTS,
        'file.save': 'Ctrl+Alt+S',
        'edit.undo': 'Ctrl+Alt+Z',
      }),
    ).toEqual({ 'file.save': 'Ctrl+Alt+S', 'edit.undo': 'Ctrl+Alt+Z' });
  });

  it('reset borra el almacenamiento y devuelve los defaults', () => {
    saveShortcuts({ ...DEFAULT_SHORTCUTS, 'file.save': 'Ctrl+Alt+S' });
    const restored = resetShortcuts();
    expect(restored).toEqual(DEFAULT_SHORTCUTS);
    expect(storedOverrides()).toBeNull();
    expect(loadShortcuts()).toEqual(DEFAULT_SHORTCUTS);
  });

  it('tolera un almacenamiento corrupto sin perder los defaults', () => {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, '{ no json');
    expect(loadShortcuts()).toEqual(DEFAULT_SHORTCUTS);
  });

  it('lee el formato legado que guardaba el mapa completo', () => {
    window.localStorage.setItem(
      SHORTCUTS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SHORTCUTS, 'file.open': 'Ctrl+Alt+O' }),
    );
    const loaded = loadShortcuts();
    expect(loaded['file.open']).toBe('Ctrl+Alt+O');
    expect(loaded['file.save']).toBe(DEFAULT_SHORTCUTS['file.save']);
  });

  it('avisa a los suscriptores con el mapa completo al guardar y al resetear', () => {
    const events: ShortcutMap[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<ShortcutMap>).detail);
    };
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, listener);
    try {
      saveShortcuts({ ...DEFAULT_SHORTCUTS, 'file.save': 'Ctrl+Alt+S' });
      resetShortcuts();
    } finally {
      window.removeEventListener(SHORTCUTS_CHANGED_EVENT, listener);
    }
    expect(events).toHaveLength(2);
    expect(events[0]?.['file.save']).toBe('Ctrl+Alt+S');
    expect(events[1]?.['file.save']).toBe(DEFAULT_SHORTCUTS['file.save']);
  });

  it('getShortcut refleja el override guardado', () => {
    saveShortcuts({ ...DEFAULT_SHORTCUTS, 'file.save': 'Ctrl+Alt+S' });
    expect(getShortcut('file.save')).toBe('Ctrl+Alt+S');
    expect(getShortcut('file.open')).toBe(DEFAULT_SHORTCUTS['file.open']);
  });
});

describe('validación de una reasignación', () => {
  it('acepta un binding libre en formato canónico', () => {
    const result = assignShortcut(DEFAULT_SHORTCUTS, 'file.save', 'ctrl+alt+s');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding).toBe('Ctrl+Alt+S');
    expect(result.map['file.save']).toBe('Ctrl+Alt+S');
    // No muta el mapa original.
    expect(DEFAULT_SHORTCUTS['file.save']).toBe('Ctrl+S');
  });

  it('rechaza un binding que ya usa otro atajo y dice cuál', () => {
    const result = assignShortcut(DEFAULT_SHORTCUTS, 'file.save', 'Ctrl+O');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    expect(result.conflictId).toBe('file.open');
  });

  it('permite volver a asignar el mismo binding al mismo atajo', () => {
    const result = assignShortcut(DEFAULT_SHORTCUTS, 'file.save', DEFAULT_SHORTCUTS['file.save']);
    expect(result.ok).toBe(true);
  });

  it('rechaza letras peladas que romperían la escritura', () => {
    const result = assignShortcut(DEFAULT_SHORTCUTS, 'file.save', 'A');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-bindable');
  });

  it('acepta teclas especiales solas y combinaciones con Ctrl/Alt', () => {
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'nav.home', 'F8').ok).toBe(true);
    expect(assignShortcut(DEFAULT_SHORTCUTS, 'nav.home', 'Alt+1').ok).toBe(true);
    // Escape ya es "Deseleccionar todo": es especial, pero está tomado.
    const escape = assignShortcut(DEFAULT_SHORTCUTS, 'nav.home', 'Escape');
    expect(escape.ok).toBe(false);
    if (!escape.ok) expect(escape.reason).toBe('conflict');
  });

  it('findShortcutConflict ignora al propio atajo y encuentra al dueño', () => {
    expect(findShortcutConflict(DEFAULT_SHORTCUTS, 'file.save', 'Ctrl+S')).toBeNull();
    expect(findShortcutConflict(DEFAULT_SHORTCUTS, 'file.save', 'ctrl+shift+z')).toBe(
      'edit.redo',
    );
    expect(findShortcutConflict(DEFAULT_SHORTCUTS, 'file.save', '')).toBeNull();
  });
});
