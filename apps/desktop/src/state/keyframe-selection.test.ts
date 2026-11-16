import { describe, expect, it, vi } from 'vitest';
import {
  getSelectedKeyframe,
  setSelectedKeyframe,
  subscribeKeyframeSelection,
} from './keyframe-selection';

describe('selección de keyframe compartida', () => {
  it('guarda y limpia la referencia clip+frame', () => {
    setSelectedKeyframe(null);
    setSelectedKeyframe({ clipId: 'clip-1', frame: 42 });
    expect(getSelectedKeyframe()).toEqual({ clipId: 'clip-1', frame: 42 });
    setSelectedKeyframe(null);
    expect(getSelectedKeyframe()).toBeNull();
  });

  it('no notifica cuando la referencia no cambia', () => {
    setSelectedKeyframe(null);
    const listener = vi.fn();
    const unsub = subscribeKeyframeSelection(listener);
    setSelectedKeyframe({ clipId: 'clip-1', frame: 10 });
    setSelectedKeyframe({ clipId: 'clip-1', frame: 10 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setSelectedKeyframe({ clipId: 'clip-2', frame: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
    setSelectedKeyframe(null);
  });
});
