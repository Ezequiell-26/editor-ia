import { afterEach, describe, expect, it } from 'vitest';
import {
  getMediaSpy,
  hideMediaSpy,
  pinMediaSpy,
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
      pinned: false,
    });
    scrubMediaSpy('a1', 7.5);
    expect(getMediaSpy()?.timeSeconds).toBe(7.5);
    expect(getMediaSpy()?.assetId).toBe('a1');
  });

  it('scrub sin espía activo es no-op y hide limpia', () => {
    scrubMediaSpy('a1', 4);
    expect(getMediaSpy()).toBeNull();
    showMediaSpy('a2', '/media/y.png', 'image', 0, 0);
    hideMediaSpy();
    expect(getMediaSpy()).toBeNull();
  });

  it('scrub de otra tarjeta no mueve el tiempo del espía activo', () => {
    showMediaSpy('a1', '/media/x.mp4', 'video', 12, 3);
    scrubMediaSpy('a2', 9);
    expect(getMediaSpy()?.timeSeconds).toBe(3);
  });

  it('pinMediaSpy fija el medio y bloquea el hover de otros', () => {
    pinMediaSpy('a1', '/media/x.mp4', 'video', 12, 0);
    expect(getMediaSpy()?.pinned).toBe(true);
    showMediaSpy('a2', '/media/y.mp4', 'video', 8, 1);
    expect(getMediaSpy()?.assetId).toBe('a1');
    expect(getMediaSpy()?.pinned).toBe(true);
  });

  it('pinMediaSpy sobre el mismo medio alterna y scrub sigue limitado', () => {
    pinMediaSpy('a1', '/media/x.mp4', 'video', 12, 0);
    pinMediaSpy('a1', '/media/x.mp4', 'video', 12, 0);
    expect(getMediaSpy()?.pinned).toBe(false);
    showMediaSpy('a2', '/media/y.mp4', 'video', 8, 1);
    expect(getMediaSpy()?.assetId).toBe('a2');
  });

  it('pinMediaSpy sobre otro medio reemplaza fijado por fijado', () => {
    pinMediaSpy('a1', '/media/x.mp4', 'video', 12, 0);
    pinMediaSpy('a2', '/media/y.mp4', 'video', 8, 2);
    expect(getMediaSpy()).toMatchObject({ assetId: 'a2', pinned: true, timeSeconds: 2 });
  });
});
