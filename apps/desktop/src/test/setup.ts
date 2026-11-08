import { configure } from '@testing-library/dom';
import { vi } from 'vitest';

// Las vistas se cargan por chunks lazy: en una máquina cargada el primer
// render de una vista puede tardar más de 1 s (el default de `waitFor` /
// `findBy*`) y la suite fallaba de forma intermitente con "Unable to find".
// 5 s es el mismo tope que los tests ya declaran a mano en `App.test.tsx`.
configure({ asyncUtilTimeout: 5000 });

// jsdom does not implement media playback. The preview calls play/pause in an
// effect; stubbing them keeps the UI tests focused on state and layout without
// printing "Not implemented" noise for every mounted video/audio element.
if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
}

// jsdom no implementa PointerEvent: sin esto, `fireEvent.pointerDown/Move`
// despacha eventos sin clientX/clientY y los arrastres quedan en NaN.
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  // @ts-expect-error jsdom no trae la clase; la definimos para los tests.
  window.PointerEvent = PointerEventPolyfill;
}
