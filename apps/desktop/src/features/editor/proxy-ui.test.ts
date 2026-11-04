import { describe, expect, it } from 'vitest';
import {
  isProxyCandidate,
  proxyActionLabel,
  proxyBadge,
  proxyPlaybackPath,
  type ProxyStatusLike,
} from './proxy-ui';

function status(overrides: Partial<ProxyStatusLike> = {}): ProxyStatusLike {
  return {
    assetId: 'asset-1',
    state: 'ready',
    quality: '540p',
    path: 'media/proxies/proxy-asset-1-540p.mp4',
    exists: true,
    upToDate: true,
    percent: 100,
    phase: 'ready',
    error: null,
    ...overrides,
  };
}

describe('proxy ui helpers', () => {
  it('marca candidatos >1080p/4K sólo para video', () => {
    expect(isProxyCandidate({ kind: 'video', media: { width: 3840, height: 2160 } })).toBe(true);
    expect(isProxyCandidate({ kind: 'video', media: { width: 1920, height: 1080 } })).toBe(false);
    expect(isProxyCandidate({ kind: 'image', media: { width: 4000, height: 3000 } })).toBe(false);
    expect(isProxyCandidate({ kind: 'audio', media: {} })).toBe(false);
  });

  it('etiqueta estados y progreso de la cola', () => {
    expect(proxyBadge(status())).toEqual({ label: 'Proxy listo', tone: 'ready', percent: null });
    expect(proxyBadge(status({ state: 'generating', percent: 42.6 }))).toEqual({
      label: 'Generando proxy',
      tone: 'busy',
      percent: 43,
    });
    expect(proxyBadge(status({ state: 'queued', percent: -5 })).percent).toBe(0);
    expect(proxyBadge(status({ state: 'failed', exists: false })).tone).toBe('warn');
    expect(proxyBadge(null).label).toBe('Sin proxy');
  });

  it('sólo reproduce proxy si existe y está actualizado', () => {
    expect(proxyPlaybackPath(status())).toBe('media/proxies/proxy-asset-1-540p.mp4');
    expect(proxyPlaybackPath(status({ upToDate: false }))).toBeNull();
    expect(proxyPlaybackPath(status({ state: 'generating' }))).toBeNull();
    expect(proxyPlaybackPath(null)).toBeNull();
  });

  it('elige la etiqueta de acción correcta', () => {
    expect(proxyActionLabel(undefined)).toBe('Generar proxy');
    expect(proxyActionLabel(status({ state: 'failed' }))).toBe('Reintentar proxy');
    expect(proxyActionLabel(status({ state: 'cancelled' }))).toBe('Reintentar proxy');
    expect(proxyActionLabel(status({ state: 'queued' }))).toBe('Cancelar');
    expect(proxyActionLabel(status())).toBe('Listo');
  });
});
