import { describe, expect, it, vi } from 'vitest';
import {
  getSelectedTransition,
  setSelectedTransition,
  subscribeTransitionSelection,
} from './transition-selection';

describe('selección de transición compartida', () => {
  it('guarda y limpia la referencia al clip dueño', () => {
    setSelectedTransition(null);
    setSelectedTransition({ clipId: 'clip-1' });
    expect(getSelectedTransition()).toEqual({ clipId: 'clip-1' });
    setSelectedTransition(null);
    expect(getSelectedTransition()).toBeNull();
  });

  it('no notifica cuando la referencia no cambia', () => {
    setSelectedTransition(null);
    const listener = vi.fn();
    const unsub = subscribeTransitionSelection(listener);
    setSelectedTransition({ clipId: 'clip-1' });
    setSelectedTransition({ clipId: 'clip-1' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setSelectedTransition({ clipId: 'clip-2' });
    expect(listener).toHaveBeenCalledTimes(1);
    setSelectedTransition(null);
  });
});
