import { describe, expect, it } from 'vitest';
import { createFakeService, fakeAudioPeaks } from '../test/fake-service';
import {
  NATIVE_UNAVAILABLE_REASON,
  baseName,
  createDesktopService,
  createNativeDesktopService,
  isLocalProviderUrl,
  joinProjectPath,
  providerUrlProblem,
  safeDisplayLabel,
  sanitizeForUi,
} from './project-service';

describe('helpers del borde nativo', () => {
  it('deja solo el nombre del archivo en las etiquetas y errores', () => {
    expect(safeDisplayLabel('C:\\Users\\persona\\proyectos\\corte.editoria.json')).toBe(
      'corte.editoria.json',
    );
    expect(baseName('/home/persona/obra.json')).toBe('obra.json');
    expect(sanitizeForUi('falló C:\\Users\\persona\\obra\\media\\a.mp4')).not.toContain(
      'persona',
    );
  });

  it('une rutas relativas con el separador del proyecto', () => {
    expect(joinProjectPath('C:\\trabajo\\obra', 'media/toma.mp4')).toBe(
      'C:\\trabajo\\obra\\media\\toma.mp4',
    );
    expect(joinProjectPath('/home/obra/', 'media/toma.mp4')).toBe('/home/obra/media/toma.mp4');
  });

  it('reconoce loopback exacto y rechaza hosts con prefijo parecido', () => {
    expect(isLocalProviderUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalProviderUrl('https://localhost:8443/v1')).toBe(true);
    expect(isLocalProviderUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalProviderUrl('http://127.0.0.1.evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('http://localhost.evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('http://localhost@evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('exige https para proveedores remotos y prohíbe userinfo', () => {
    expect(providerUrlProblem('https://api.openai.com/v1')).toBeNull();
    expect(providerUrlProblem('http://127.0.0.1:11434/v1')).toBeNull();
    expect(providerUrlProblem('http://api.openai.com/v1')).toMatch(/https/);
    expect(providerUrlProblem('https://user:pass@api.openai.com/v1')).toMatch(/usuario/);
    expect(providerUrlProblem('ftp://localhost/v1')).toMatch(/http/);
    expect(providerUrlProblem('no es una url')).toMatch(/válida/);
  });
});

describe('picos de audio (contrato de la forma de onda)', () => {
  it('invoca audio_peaks con assetId y buckets (600 por defecto) y devuelve el shape tipado', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const peaks = {
      assetId: 'asset-1',
      durationSeconds: 12.5,
      buckets: 600,
      peaks: [
        { min: -0.5, max: 0.5 },
        { min: -1, max: 1 },
      ],
    };
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      return peaks;
    });

    await expect(service.audioPeaks('asset-1')).resolves.toEqual(peaks);
    await expect(service.audioPeaks('asset-1', 1500)).resolves.toEqual(peaks);
    expect(calls).toEqual([
      { command: 'audio_peaks', args: { assetId: 'asset-1', buckets: 600 } },
      { command: 'audio_peaks', args: { assetId: 'asset-1', buckets: 1500 } },
    ]);
  });

  it('invoca audio_peaks_path para archivos sueltos con el mismo shape', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      return { assetId: 'C:\\media\\a.wav', durationSeconds: 0, buckets: 600, peaks: [] };
    });
    await service.audioPeaksPath('C:\\media\\a.wav');
    expect(calls).toEqual([
      { command: 'audio_peaks_path', args: { path: 'C:\\media\\a.wav', buckets: 600 } },
    ]);
  });

  it('en navegador rechaza honesto con NATIVE_UNAVAILABLE_REASON (sin fake)', async () => {
    const service = createDesktopService();
    await expect(service.audioPeaks('asset-1')).rejects.toThrow(NATIVE_UNAVAILABLE_REASON);
    await expect(service.audioPeaksPath('C:\\media\\a.wav')).rejects.toThrow(
      NATIVE_UNAVAILABLE_REASON,
    );
  });

  it('el fake replica el contrato: buckets clampeados [16,4000] y min/max en [-1,1]', async () => {
    const service = createFakeService();
    const defaults = await service.audioPeaks('asset-1');
    expect(defaults.buckets).toBe(600);
    expect(defaults.peaks).toHaveLength(600);
    expect(defaults.durationSeconds).toBe(4);
    expect(defaults.assetId).toBe('asset-1');

    expect((await service.audioPeaks('asset-1', 5)).buckets).toBe(16);
    expect((await service.audioPeaks('asset-1', 9000)).buckets).toBe(4000);
    expect((await service.audioPeaks('asset-1', 9000)).peaks).toHaveLength(4000);
    // Determinista: dos llamadas iguales devuelven exactamente lo mismo.
    expect(await fakeAudioPeaks('asset-1', 120)).toEqual(await fakeAudioPeaks('asset-1', 120));

    const peaks = await service.audioPeaks('asset-1', 120);
    for (const pair of peaks.peaks) {
      expect(pair.min).toBeGreaterThanOrEqual(-1);
      expect(pair.max).toBeLessThanOrEqual(1);
      expect(pair.min).toBeLessThanOrEqual(pair.max);
    }
  });
});

describe('Fase 1 · contrato de proxies', () => {
  it('invoca proxy_status/ensure_proxy/cancel_proxy/cleanup_proxies con args camelCase', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const ready = {
      assetId: 'asset-1',
      state: 'ready',
      quality: '720p',
      path: 'media/proxies/proxy-1.mp4',
      exists: true,
      upToDate: true,
      width: 1280,
      height: 720,
      bytes: 2_000_000,
      durationSeconds: 12,
      percent: 100,
      phase: 'ready',
      error: null,
      sourceMtimeMs: 1,
      updatedAtMs: 2,
    };
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      if (command === 'apply_proxy_to_asset') return null;
      if (command === 'cleanup_proxies') return { removed: 2, bytesFreed: 3000 };
      return ready;
    });

    await expect(service.proxyStatus('asset-1')).resolves.toMatchObject({ state: 'ready' });
    await service.ensureProxy('asset-1');
    await service.ensureProxy('asset-1', '720p');
    await service.cancelProxy('asset-1');
    await service.applyProxyToAsset('asset-1');
    await expect(service.cleanupProxies()).resolves.toEqual({ removed: 2, bytesFreed: 3000 });
    await service.cleanupProxies('asset-1');

    expect(calls).toEqual([
      { command: 'proxy_status', args: { assetId: 'asset-1' } },
      { command: 'ensure_proxy', args: { assetId: 'asset-1', quality: null } },
      { command: 'ensure_proxy', args: { assetId: 'asset-1', quality: '720p' } },
      { command: 'cancel_proxy', args: { assetId: 'asset-1' } },
      { command: 'apply_proxy_to_asset', args: { assetId: 'asset-1' } },
      { command: 'cleanup_proxies', args: { assetId: null } },
      { command: 'cleanup_proxies', args: { assetId: 'asset-1' } },
    ]);
  });

  it('en navegador rechaza proxy con NATIVE_UNAVAILABLE_REASON', async () => {
    const service = createDesktopService();
    await expect(service.proxyStatus('asset-1')).rejects.toThrow(NATIVE_UNAVAILABLE_REASON);
    await expect(service.ensureProxy('asset-1', '540p')).rejects.toThrow(
      NATIVE_UNAVAILABLE_REASON,
    );
    await expect(service.cancelProxy('asset-1')).rejects.toThrow(NATIVE_UNAVAILABLE_REASON);
  });

  it('el fake pasa de missing a ready, emite progreso y cancelar no rompe', async () => {
    const service = createFakeService();
    const events: string[] = [];
    const unsubscribe = await service.onProxyProgress((event) => {
      events.push(`${event.state}:${event.percent}`);
    });
    await expect(service.proxyStatus('asset-9')).resolves.toMatchObject({
      state: 'missing',
      exists: false,
    });
    const ready = await service.ensureProxy('asset-9', '720p');
    expect(ready.state).toBe('ready');
    expect(ready.path).toContain('media/proxies/');
    expect(ready.width).toBe(1280);
    expect(ready.height).toBe(720);
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    expect(events).toContain('ready:100');
    await expect(service.proxyStatus('asset-9')).resolves.toMatchObject({ state: 'ready' });
    await expect(service.cancelProxy('asset-9')).resolves.toMatchObject({ state: 'ready' });
    unsubscribe();
  });
});

describe('Fase 1 · contrato de export avanzado', () => {
  it('invoca export_capabilities y verify_export', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      if (command === 'export_capabilities') {
        return { containers: [], pixelFormats: [], videoCodecs: {}, audioCodecs: [], hdr: false, maxWidth: 1, maxHeight: 1 };
      }
      return {
        path: 'C:/out.mp4',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1920,
        height: 1080,
        fpsNum: 30,
        fpsDen: 1,
        pixelFormat: 'yuv420p',
        videoBitrate: 1,
        audioBitrate: 2,
        colorSpace: 'bt709',
        colorTransfer: 'bt709',
        colorPrimaries: 'bt709',
        hdr: false,
        durationSeconds: 10,
        bytes: 100,
        warnings: [],
      };
    });
    await service.exportCapabilities();
    await service.verifyExport('C:/out.mp4');
    expect(calls).toEqual([
      { command: 'export_capabilities', args: {} },
      { command: 'verify_export', args: { path: 'C:/out.mp4' } },
    ]);
  });

  it('el fake reporta la matriz real y una verificación determinista', async () => {
    const service = createFakeService();
    const capabilities = await service.exportCapabilities();
    expect(capabilities.hdr).toBe(false);
    expect(capabilities.containers.map((item) => item.container)).toEqual(['mp4', 'mov', 'webm']);
    expect(capabilities.videoCodecs.av1?.software.length).toBeGreaterThan(0);
    const verification = await service.verifyExport('C:/samples/out.webm');
    expect(verification.container).toBe('webm');
    expect(verification.videoCodec).toBe('vp9');
    expect(verification.hdr).toBe(false);
  });
});

describe('Fase 1 · recuperación, historial y duplicados', () => {
  it('invoca los comandos de recuperación con los args esperados', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      if (command === 'choose_media_folder') return 'C:\\media';
      if (command === 'relink_asset') return { ok: true, assetId: 'a1' };
      if (command === 'relink_assets_from_folder') return { relinked: [], stillMissing: [], rejected: [] };
      if (command === 'restore_project_version') return { restoreMode: 'in-place', projectPath: 'p', backupPath: null, version: {} };
      return [];
    });

    await expect(service.chooseMediaFolder('Elegir medios')).resolves.toBe('C:\\media');
    await service.findMissingAssets();
    await service.findMissingAssets('C:\\proj\\obra.editoria.json');
    await service.relinkAsset('a1', 'C:\\media\\a1.mp4');
    await service.relinkAssetsFromFolder(null, 'C:\\media');
    await service.listProjectVersions('C:\\proj\\obra.editoria.json');
    await service.restoreProjectVersion('C:\\proj\\obra.editoria.json', 'v1', 'copy');
    await service.findDuplicateAssets();

    expect(calls).toEqual([
      { command: 'choose_media_folder', args: { title: 'Elegir medios' } },
      { command: 'find_missing_assets', args: { projectPath: null } },
      { command: 'find_missing_assets', args: { projectPath: 'C:\\proj\\obra.editoria.json' } },
      { command: 'relink_asset', args: { assetId: 'a1', newPath: 'C:\\media\\a1.mp4' } },
      { command: 'relink_assets_from_folder', args: { projectPath: null, folder: 'C:\\media' } },
      { command: 'list_project_versions', args: { projectPath: 'C:\\proj\\obra.editoria.json' } },
      {
        command: 'restore_project_version',
        args: { projectPath: 'C:\\proj\\obra.editoria.json', versionId: 'v1', mode: 'copy' },
      },
      { command: 'find_duplicate_assets', args: { projectPath: null } },
    ]);
  });

  it('en navegador rechaza honesto todas las operaciones de recuperación', async () => {
    const service = createDesktopService();
    for (const operation of [
      () => service.findMissingAssets(),
      () => service.relinkAsset('a1', 'x'),
      () => service.relinkAssetsFromFolder(null, 'x'),
      () => service.listProjectVersions(),
      () => service.restoreProjectVersion('p', 'v'),
      () => service.findDuplicateAssets(),
      () => service.chooseMediaFolder(),
    ]) {
      await expect(operation()).rejects.toThrow(NATIVE_UNAVAILABLE_REASON);
    }
  });

  it('el fake devuelve contratos vacíos deterministas y relink ok', async () => {
    const service = createFakeService();
    expect(await service.findMissingAssets()).toEqual([]);
    expect(await service.findDuplicateAssets()).toEqual([]);
    expect(await service.listProjectVersions()).toEqual([]);
    expect(await service.chooseMediaFolder()).toBe('C:\\tester\\medios');
    await expect(service.relinkAsset('a1', 'C:\\media\\a1.mp4')).resolves.toMatchObject({
      ok: true,
      assetId: 'a1',
      copied: false,
    });
  });
});

describe('probar conexión del proveedor', () => {
  it('llama al comando nativo test_provider y devuelve el resultado tipado', async () => {
    const calls: { command: string; args: unknown }[] = [];
    const service = createNativeDesktopService(async (command, args) => {
      calls.push({ command, args });
      return {
        status: 'ok',
        ok: true,
        httpStatus: 200,
        latencyMs: 12,
        model: 'llama3.1',
        detail: 'conexión correcta: el modelo configurado «llama3.1» está disponible',
        baseUrl: 'http://127.0.0.1:11434/v1',
      };
    });

    await expect(service.testProvider()).resolves.toMatchObject({
      status: 'ok',
      ok: true,
      httpStatus: 200,
      model: 'llama3.1',
    });
    expect(calls).toEqual([{ command: 'test_provider', args: {} }]);
  });

  it('en navegador rechaza con el motivo nativo, sin simular una conexión', async () => {
    const service = createDesktopService();
    expect(service.available).toBe(false);
    await expect(service.testProvider()).rejects.toThrow(NATIVE_UNAVAILABLE_REASON);
  });
});
