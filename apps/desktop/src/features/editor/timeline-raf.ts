/**
 * Coalescing de eventos por frame para el timeline.
 *
 * `pointermove` puede dispararse 100+ veces por segundo (mouse de 1000 Hz) y
 * cada actualización de estado de React re-renderiza la timeline completa. Este
 * scheduler guarda el ÚLTIMO valor y lo aplica una sola vez por frame de
 * pantalla (requestAnimationFrame). El consumidor debe llamar `flush()` al
 * soltar el pointer para no perder el valor final y `cancel()` al desmontar.
 *
 * Se usa en arrastre de clips/cues, fades, scrub y pan. En entornos sin rAF
 * (SSR/tests viejos) cae a `queueMicrotask`, así el comportamiento es el mismo
 * de forma observable.
 */
export interface RafCoalescer<T> {
  /** Guarda el valor y programa su aplicación en el próximo frame. */
  push(value: T): void;
  /** Aplica ya el último valor pendiente (sin esperar al frame). */
  flush(): void;
  /** Descarta el valor pendiente. */
  cancel(): void;
  /** Hay un valor pendiente de aplicar. */
  hasPending(): boolean;
}

type FrameHandle = { kind: 'raf'; id: number } | { kind: 'microtask'; id: number };

export function createRafCoalescer<T>(apply: (value: T) => void): RafCoalescer<T> {
  let frame: FrameHandle | null = null;
  let pending = false;
  let latestValue: T | undefined;

  const run = (): void => {
    frame = null;
    if (!pending) return;
    pending = false;
    const value = latestValue as T;
    latestValue = undefined;
    apply(value);
  };

  const schedule = (): void => {
    if (frame) return;
    if (typeof requestAnimationFrame === 'function') {
      frame = { kind: 'raf', id: requestAnimationFrame(run) };
    } else if (typeof queueMicrotask === 'function') {
      // Fallback raro (SSR): mantiene la semántica de "un apply por turno".
      frame = { kind: 'microtask', id: 0 };
      queueMicrotask(run);
    } else {
      run();
    }
  };

  const cancel = (): void => {
    if (frame?.kind === 'raf' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame.id);
    }
    frame = null;
    pending = false;
    latestValue = undefined;
  };

  return {
    push(value: T): void {
      latestValue = value;
      pending = true;
      schedule();
    },
    flush(): void {
      if (frame?.kind === 'raf' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame.id);
      }
      frame = null;
      run();
    },
    cancel,
    hasPending: () => pending,
  };
}
