import { afterEach, describe, expect, it } from 'vitest';
import {
  getMediaSpy,
  hideMediaSpy,
  scrubMediaSpy,
  showMediaSpy,
} from './media-spy';

// El store es módulo-level: cada test deja el estado limpio al final.
afterEach(() => hideMediaSpy());

describe('media-spy store', () => {
  it('showMediaSpy expone el medio y scrub actualiza sólo el tiempo', () => {
    showMediaSpy('a1', '/media/x.mp4', 'video', 12, 3);
    expect(getMediaSpy()).toMatchObject({
      assetId: 'a1',
      url: '/media/x.mp4',
      kind: 'video',
      durationSeconds: 12,
      timeSeconds: 3,
    });
    scrubMediaSpy(7.5);
    expect(getMediaSpy()?.timeSeconds).toBe(7.5);
    expect(getMediaSpy()?.assetId).toBe('a1');
  });

  it('scrub sin espía activo es no-op y hide limpia', () => {
    scrubMediaSpy(4);
    expect(getMediaSpy()).toBeNull();
    showMediaSpy('a2', '/media/y.png', 'image', 0, 0);
    hideMediaSpy();
    expect(getMediaSpy()).toBeNull();
  });
});
