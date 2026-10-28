// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  SHORTCUT_LABELS,
  bindingMatches,
  isActivatableTarget,
  normalizeBinding,
  type ShortcutId,
} from './shortcuts';

/**
 * Fase 2 de accesibilidad:
 *  1. `isActivatableTarget` — el despacho global de Space no debe robar la
 *     activación nativa de los controles enfocados (auditoría H16);
 *  2. los atajos nuevos de edición de clip por teclado no chocan con ninguna
 *     tecla ya registrada y quedan cubiertos por las tres tablas del registro.
 */

const IDS_DE_CLIP: readonly ShortcutId[] = [
  'timeline.clipMoveLeft',
  'timeline.clipMoveRight',
  'timeline.clipMoveTrackUp',
  'timeline.clipMoveTrackDown',
  'timeline.clipTrimIn',
  'timeline.clipTrimOut',
];

describe('Space no roba la activación (isActivatableTarget)', () => {
  it('reconoce los controles que se activan con Space', () => {
    expect(isActivatableTarget(document.createElement('button'))).toBe(true);
    const clip = document.createElement('div');
    clip.setAttribute('role', 'button');
    expect(isActivatableTarget(clip)).toBe(true);
    const item = document.createElement('span');
    item.setAttribute('role', 'menuitem');
    expect(isActivatableTarget(item)).toBe(true);
    expect(isActivatableTarget(document.createElement('select'))).toBe(true);
  });

  it('no marca lo que no se activa con Space (sliders, texto, fondo)', () => {
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.setAttribute('tabindex', '0');
    expect(isActivatableTarget(slider)).toBe(false);
    expect(isActivatableTarget(document.createElement('div'))).toBe(false);
    expect(isActivatableTarget(document.createElement('span'))).toBe(false);
    expect(isActivatableTarget(document.body)).toBe(false);
    expect(isActivatableTarget(null)).toBe(false);
  });

  it('Espacio sobre un botón enfocado no dispara el binding de reproducción', () => {
    const button = document.createElement('button');
    button.textContent = 'Silenciar pista';
    document.body.appendChild(button);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    // El binding sigue siendo Space; el despacho debe apartarse al ver el
    // botón enfocado y dejar que el navegador active el control en keyup.
    expect(bindingMatches(event, DEFAULT_SHORTCUTS['playback.playPause'])).toBe(true);
    expect(isActivatableTarget(event.target)).toBe(true);
    button.remove();
  });
});

describe('atajos de clip por teclado en el registro', () => {
  it('los seis atajos nuevos usan las teclas acordadas sin duplicar ninguna', () => {
    expect(DEFAULT_SHORTCUTS['timeline.clipMoveLeft']).toBe('Alt+ArrowLeft');
    expect(DEFAULT_SHORTCUTS['timeline.clipMoveRight']).toBe('Alt+ArrowRight');
    expect(DEFAULT_SHORTCUTS['timeline.clipMoveTrackUp']).toBe('Alt+ArrowUp');
    expect(DEFAULT_SHORTCUTS['timeline.clipMoveTrackDown']).toBe('Alt+ArrowDown');
    expect(DEFAULT_SHORTCUTS['timeline.clipTrimIn']).toBe('Ctrl+Alt+ArrowLeft');
    expect(DEFAULT_SHORTCUTS['timeline.clipTrimOut']).toBe('Ctrl+Alt+ArrowRight');

    const usadas = new Map<string, ShortcutId>();
    for (const [id, binding] of Object.entries(DEFAULT_SHORTCUTS) as [ShortcutId, string][]) {
      const clave = normalizeBinding(binding);
      const dueno = usadas.get(clave);
      expect(dueno, `"${binding}" ya lo usa "${dueno ?? '??'}" y también "${id}"`).toBeUndefined();
      usadas.set(clave, id);
    }
  });

  it('las flechas del playhead siguen libres: ni Arrow ni Shift+Arrow están registradas', () => {
    const combos = [
      new KeyboardEvent('keydown', { key: 'ArrowLeft' }),
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }),
      new KeyboardEvent('keydown', { key: 'ArrowUp' }),
      new KeyboardEvent('keydown', { key: 'ArrowDown' }),
    ];
    for (const event of combos) {
      for (const [id, binding] of Object.entries(DEFAULT_SHORTCUTS) as [ShortcutId, string][]) {
        expect(bindingMatches(event, binding), `"${binding}" (${id}) no debía capturar la flecha`).toBe(
          false,
        );
      }
    }
  });

  it('cada tecla nueva dispara su propio binding canónico', () => {
    const casos: readonly (readonly [KeyboardEvent, ShortcutId])[] = [
      [new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }), 'timeline.clipMoveLeft'],
      [new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }), 'timeline.clipMoveRight'],
      [new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }), 'timeline.clipMoveTrackUp'],
      [new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true }), 'timeline.clipMoveTrackDown'],
      [
        new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, altKey: true }),
        'timeline.clipTrimIn',
      ],
      [
        new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, altKey: true }),
        'timeline.clipTrimOut',
      ],
    ];
    for (const [event, id] of casos) {
      expect(bindingMatches(event, DEFAULT_SHORTCUTS[id]), `falta el binding de ${id}`).toBe(true);
    }
  });

  it('el registro queda completo: etiqueta, categoría y forma canónica para los ids nuevos', () => {
    for (const id of IDS_DE_CLIP) {
      expect(SHORTCUT_LABELS[id]?.trim(), `sin etiqueta: ${id}`).toBeTruthy();
      expect(SHORTCUT_CATEGORIES[id], `categoría de ${id}`).toBe('Timeline');
      expect(normalizeBinding(DEFAULT_SHORTCUTS[id]), `binding de ${id} canónico`).toBe(
        DEFAULT_SHORTCUTS[id],
      );
    }
  });
});
