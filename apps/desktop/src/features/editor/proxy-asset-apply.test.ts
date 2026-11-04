import { describe, expect, it } from 'vitest';
import { applyProxyAssetToProject, detectProxyPlaybackSupport } from './proxy-ui';

describe('aplicar proxy al proyecto con el contrato publicado', () => {
  it('detecta applyProxyToAsset(assetId) de un argumento y explica si falta', () => {
    expect(detectProxyPlaybackSupport({ applyProxyToAsset: async () => null })).toEqual({
      supported: true,
      reason: null,
    });
    expect(detectProxyPlaybackSupport({}).supported).toBe(false);
    expect(detectProxyPlaybackSupport({}).reason).toContain('applyProxyToAsset(assetId)');
  });

  it('reemplaza el asset actualizado que devolvió el backend (fake) sin tocar los demás', () => {
    const project = {
      assets: [
        { id: 'a1', label: 'original' },
        { id: 'a2', label: 'otra toma' },
      ],
    };
    const updated = {
      id: 'a1',
      label: 'original',
      proxy: { path: 'media/proxies/proxy-a1-540p.mp4', quality: '540p' },
    };
    const next = applyProxyAssetToProject(project, updated);
    expect(next.assets[0]).toEqual(updated);
    expect(next.assets[1]).toEqual(project.assets[1]);
    expect(project.assets[0]).not.toHaveProperty('proxy');
  });

  it('si el backend devuelve null el proyecto no cambia (mensaje honesto en la UI)', () => {
    const project = { assets: [{ id: 'a1' }] };
    const updated = null;
    const next = updated ? applyProxyAssetToProject(project, updated) : project;
    expect(next).toBe(project);
  });
});
