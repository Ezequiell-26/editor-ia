import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimProxyStatusFetch,
  getProxyStatus,
  proxyStatusVersion,
  publishProxyStatus,
  resetProxyStatusStoreForTests,
} from './proxy-status-store';
import type { ProxyStatus } from '../../services/contracts/media';

function status(assetId: string, overrides: Partial<ProxyStatus> = {}): ProxyStatus {
  return {
    assetId,
    state: 'ready',
    quality: '540p',
    path: `media/proxies/${assetId}.mp4`,
    exists: true,
    upToDate: true,
    width: 960,
    height: 540,
    bytes: 1000,
    durationSeconds: 10,
    percent: 100,
    phase: 'ready',
    error: null,
    sourceMtimeMs: null,
    updatedAtMs: 0,
    ...overrides,
  };
}

describe('proxy status store', () => {
  beforeEach(() => {
    resetProxyStatusStoreForTests();
  });

  it('publica y lee estados por assetId', () => {
    expect(getProxyStatus('a1')).toBeUndefined();
    publishProxyStatus(status('a1'));
    expect(getProxyStatus('a1')?.state).toBe('ready');
    publishProxyStatus(status('a1', { state: 'generating', percent: 40 }));
    expect(getProxyStatus('a1')?.percent).toBe(40);
    publishProxyStatus(null, 'a1');
    expect(getProxyStatus('a1')).toBeUndefined();
  });

  it('no re-emite cuando el estado publicado no cambia', () => {
    const before = proxyStatusVersion();
    publishProxyStatus(status('a1'));
    const after = proxyStatusVersion();
    publishProxyStatus(status('a1'));
    expect(proxyStatusVersion()).toBe(after);
    expect(after).toBe(before + 1);
  });

  it('reclama cada asset una sola vez para fetch', () => {
    expect(claimProxyStatusFetch('a1')).toBe(true);
    expect(claimProxyStatusFetch('a1')).toBe(false);
    expect(claimProxyStatusFetch('a2')).toBe(true);
  });
});
