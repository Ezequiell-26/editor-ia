// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import { AssetsPanel } from './AssetsPanel';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery, newId } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function image(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function audio(durationFrames: number): Asset {
  return {
    id: newId(),
    label: 'narracion.wav',
    kind: 'audio',
    source: { type: 'local', path: 'media/narracion.wav' },
    status: 'ready',
    integrity: { sha256: 'f'.repeat(64), bytes: 40_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

function renderPanel(assets: Asset[] = []) {
  const project = ensureDelivery(createEmptyProject('Lote', NOW));
  project.assets = assets;
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'lote.editoria.json',
          path: 'C:\\tester\\lote.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AssetsPanel onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => cleanup());

describe('AssetsPanel · auto-montar lote', () => {
  it('importa imágenes y narración, monta el storyboard y navega al editor', async () => {
    const { service, onNavigate } = renderPanel();
    expect(screen.getByLabelText(/Movimiento automático/i)).toBeTruthy();
    expect(screen.getByLabelText(/Segundos por imagen/i)).toBeTruthy();
    expect(screen.getByLabelText(/Transición \(frames\)/i)).toBeTruthy();
    service.setImportOutcome({
      assets: [image('001.png'), image('002.png'), audio(300)],
      warnings: [],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('editor'));
    await waitFor(() => expect(screen.getByText('001.png')).toBeTruthy());
    expect(screen.getByText('002.png')).toBeTruthy();
    expect(screen.getByText('narracion.wav')).toBeTruthy();
    expect(screen.getByText(/3 clips en la timeline/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Reconectar archivo/i })).toHaveLength(3);
  });

  it('exige confirmar derechos antes de abrir el selector', () => {
    const { service } = renderPanel();
    const importSpy = vi.spyOn(service, 'importAssets');

    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    expect(importSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirmá que tenés derechos/i)).toBeTruthy();
  });

  it('avisa cuando el lote no trae imágenes y no monta nada', async () => {
    const { service, onNavigate } = renderPanel();
    service.setImportOutcome({ assets: [audio(300)], warnings: [] });

    fireEvent.click(screen.getByRole('checkbox', { name: /derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    await waitFor(() => expect(screen.getByText(/Elegí al menos una imagen/i)).toBeTruthy());
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('AssetsPanel · organización de medios', () => {
  it('filtra por favoritos, etiqueta y bin, y alterna la estrella', () => {
    const favorite = {
      ...image('favorita.png'),
      favorite: true,
      tags: ['plaza'],
      bin: 'Exteriores',
    } as Asset;
    const other = image('otra.png');
    renderPanel([favorite, other]);

    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.getByText('otra.png')).toBeTruthy();
    expect(screen.getByLabelText(/Filtrar biblioteca por bin/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Solo favoritos/i }));
    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.queryByText('otra.png')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Solo favoritos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Marcar otra.png como favorito/i }));
    fireEvent.click(screen.getByRole('button', { name: /Solo favoritos/i }));
    expect(screen.getByText('otra.png')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Buscar en la biblioteca de medios/i), {
      target: { value: 'plaza' },
    });
    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.queryByText('otra.png')).toBeNull();
  });

  it('los Smart Bins filtran por tipo y favoritos con su conteo', () => {
    const favorite = { ...image('favorita.png'), favorite: true } as Asset;
    const other = image('otra.png');
    const clip = {
      ...audio(300),
      id: newId(),
      label: 'voz.wav',
    } as Asset;
    renderPanel([favorite, other, clip]);

    const videoBin = screen.getByRole('button', { name: /^Video/ });
    expect(videoBin.textContent).toContain('0');

    fireEvent.click(screen.getByRole('button', { name: /^Imágenes/ }));
    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.getByText('otra.png')).toBeTruthy();
    expect(screen.queryByText('voz.wav')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Favoritos/ }));
    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.queryByText('otra.png')).toBeNull();
    expect(screen.queryByText('voz.wav')).toBeNull();

    // Volver a tocar el bin activo lo desactiva.
    fireEvent.click(screen.getByRole('button', { name: /^Favoritos/ }));
    expect(screen.getByText('otra.png')).toBeTruthy();
  });

  it('guarda el filtro actual como una regla propia', () => {
    const favorite = { ...image('favorita.png'), favorite: true, bin: 'Exteriores' } as Asset;
    renderPanel([favorite, image('otra.png')]);

    fireEvent.change(screen.getByLabelText(/Buscar en la biblioteca de medios/i), {
      target: { value: 'favorita' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar filtro como regla/i }));

    const bins = document.querySelector('.smart-bins');
    expect(bins?.textContent).toContain('favorita');
    expect(screen.getByText('favorita.png')).toBeTruthy();
    expect(screen.queryByText('otra.png')).toBeNull();
  });
});

describe('AssetsPanel · proxies por lote', () => {
  it('crea un proxy por cada video sin proxy y lo informa', async () => {
    const assets = [readyAsset({ label: 'Toma A' }), readyAsset({ label: 'Toma B' })];
    const { service } = renderPanel(assets);
    const spy = vi.spyOn(service, 'createVideoProxy');
    fireEvent.click(screen.getByRole('button', { name: /Proxies \(2\)/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const remaining = (await screen.findByRole('button', {
      name: /Proxies \(0\)/i,
    })) as HTMLButtonElement;
    expect(remaining.disabled).toBe(true);
  });
});
