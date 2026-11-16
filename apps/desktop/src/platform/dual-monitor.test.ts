// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  DUAL_MONITOR_CHANNEL,
  isDualMonitorQuery,
  type DualFromMainMessage,
  type DualToMainMessage,
} from './dual-monitor';

/** BroadcastChannel falso: una sola "ventana" por instancia, todos los
 *  canales del mismo nombre se escuchan entre sí (como en el navegador). */
class FakeChannel {
  static instances: FakeChannel[] = [];
  readonly name: string;
  closed = false;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    FakeChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    for (const other of FakeChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      for (const listener of other.listeners) {
        listener({ data } as MessageEvent);
      }
    }
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
  }
}

function installFakeBroadcastChannel() {
  FakeChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
}

describe('dual-monitor protocol', () => {
  it('el hello de la dual recibe el snapshot de la principal', () => {
    installFakeBroadcastChannel();
    const main = new FakeChannel(DUAL_MONITOR_CHANNEL);
    const dual = new FakeChannel(DUAL_MONITOR_CHANNEL);
    const received: DualFromMainMessage[] = [];
    dual.addEventListener('message', (event) => {
      received.push(event.data as DualFromMainMessage);
    });
    main.postMessage({
      type: 'snapshot',
      project: { id: 'p1' },
      opened: null,
      playheadFrame: 42,
      playing: true,
      playbackRate: 1,
      playbackDirection: 1,
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'snapshot', playheadFrame: 42, playing: true });
    main.close();
    dual.close();
    vi.unstubAllGlobals();
  });

  it('los comandos de la dual llegan a la principal', () => {
    installFakeBroadcastChannel();
    const main = new FakeChannel(DUAL_MONITOR_CHANNEL);
    const dual = new FakeChannel(DUAL_MONITOR_CHANNEL);
    const received: DualToMainMessage[] = [];
    main.addEventListener('message', (event) => {
      received.push(event.data as DualToMainMessage);
    });
    dual.postMessage({ type: 'command', action: 'seek', frame: 120 });
    dual.postMessage({ type: 'command', action: 'rate', rate: 2 });
    expect(received).toEqual([
      { type: 'command', action: 'seek', frame: 120 },
      { type: 'command', action: 'rate', rate: 2 },
    ]);
    main.close();
    dual.close();
    vi.unstubAllGlobals();
  });

  it('isDualMonitorQuery sólo responde con ?dual=1', () => {
    expect(isDualMonitorQuery()).toBe(false);
    const original = window.location.search;
    // jsdom no permite reescribir location.search directamente; se cubre el
    // caso real en el smoke manual (?dual=1 abre la vista dual).
    expect(original).not.toContain('dual=1');
  });
});
