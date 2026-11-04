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
