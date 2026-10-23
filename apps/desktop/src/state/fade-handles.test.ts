import { describe, expect, it } from 'vitest';
import { fadeFramesForDrag } from './fade-handles';

describe('fadeFramesForDrag', () => {
  it('moves the incoming fade with the pointer and clamps it', () => {
    expect(fadeFramesForDrag('in', 10, 5.4, 90)).toBe(15);
    expect(fadeFramesForDrag('in', 10, -40, 90)).toBe(0);
    expect(fadeFramesForDrag('in', 10, 400, 90)).toBe(90);
  });

  it('moves the outgoing fade in the opposite direction', () => {
    expect(fadeFramesForDrag('out', 12, -8, 90)).toBe(20);
    expect(fadeFramesForDrag('out', 12, 50, 90)).toBe(0);
  });
});
