import { vi } from 'vitest';

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
