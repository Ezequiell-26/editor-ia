// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
import { readyAsset } from '../test/fake-service';
import { activeThumbnailJobs, useThumbnail, withThumbnailSlot } from './useThumbnail';

function serviceWithThumbnails(track?: () => void): DesktopService {
  return {
    available: true,
    mediaThumbnail: async () => {
      track?.();
      return 'data:image/png;base64,AAAA';
    },
  } as unknown as DesktopService;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cola de miniaturas', () => {
  it('nunca pasa de cuatro trabajos simultáneos', async () => {
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    await Promise.all(Array.from({ length: 12 }, () => withThumbnailSlot(task)));
    expect(peak).toBe(4);
    expect(activeThumbnailJobs()).toBe(0);
  });

  it('devuelve el valor de la tarea y propaga los errores', async () => {
    await expect(withThumbnailSlot(async () => 7)).resolves.toBe(7);
    await expect(
      withThumbnailSlot(async () => {
        throw new Error('falló');
      }),
    ).rejects.toThrow('falló');
    expect(activeThumbnailJobs()).toBe(0);
  });
});

describe('useThumbnail', () => {
  it('pide la miniatura una sola vez por ruta y la memoriza', async () => {
    const asset: Asset = readyAsset();
    const calls = vi.fn();
    const service = serviceWithThumbnails(calls);
    const first = render(
      <Probe service={service} asset={asset} root="C:\\tester" />,
    );
    await screen.findByAltText('miniatura');
    expect(calls).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Probe service={service} asset={asset} root="C:\\tester" />);
    await screen.findByAltText('miniatura');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('no pide nada para fuentes ni textos', () => {
    const asset = readyAsset({
      kind: 'text',
      label: 'Titulo',
      source: { type: 'local', path: 'media/titulo-unico.txt' },
    }) as Asset;
    const calls = vi.fn();
    render(<Probe service={serviceWithThumbnails(calls)} asset={asset} root="C:\\tester" />);
    expect(calls).not.toHaveBeenCalled();
    expect(screen.queryByAltText('miniatura')).toBeNull();
  });
});

function Probe({
  service,
  asset,
  root,
}: {
  readonly service: DesktopService;
  readonly asset: Asset;
  readonly root: string;
}) {
  const src = useThumbnail(service, asset, root);
  return src ? <img alt="miniatura" src={src} /> : <span>sin miniatura</span>;
}
