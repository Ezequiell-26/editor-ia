import { describe, expect, it, vi } from 'vitest';
import type { DesktopService } from '../../services/project-service';
import { loadCubeLut } from './EffectOverlay';

const IDENTITY = [
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n');

function serviceWith(read: (path: string) => Promise<string>): {
  readonly service: DesktopService;
  readonly readProjectText: ReturnType<typeof vi.fn>;
} {
  const readProjectText = vi.fn(read);
  return {
    service: { readProjectText } as unknown as DesktopService,
    readProjectText,
  };
}

describe('loadCubeLut', () => {
  it('cachea por servicio y ruta sin releer el archivo', async () => {
    const { service, readProjectText } = serviceWith(async () => IDENTITY);
    const first = loadCubeLut(service, 'D:\\proyecto', 'media/luts/uno.cube');
    const second = loadCubeLut(service, 'D:\\proyecto', 'media/luts/uno.cube');
    expect(second).toBe(first);
    const lut = await first;
    expect(lut.size).toBe(2);
    expect(readProjectText).toHaveBeenCalledTimes(1);
    // Otra raíz es otra entrada de cache: el mismo path puede existir en dos
    // proyectos distintos con contenido distinto.
    const otherRoot = loadCubeLut(service, 'D:\\otro', 'media/luts/uno.cube');
    expect(otherRoot).not.toBe(first);
    await otherRoot;
    expect(readProjectText).toHaveBeenCalledTimes(2);
  });

  it('no cachea un parseo fallido y permite reintentar', async () => {
    let call = 0;
    const { service, readProjectText } = serviceWith(async () => {
      call += 1;
      return call === 1 ? 'LUT_3D_SIZE 2' : IDENTITY;
    });
    await expect(loadCubeLut(service, 'D:\\p', 'media/luts/x.cube')).rejects.toThrow(/incompleto/);
    await expect(loadCubeLut(service, 'D:\\p', 'media/luts/x.cube')).resolves.toMatchObject({ size: 2 });
    expect(readProjectText).toHaveBeenCalledTimes(2);
  });
});
