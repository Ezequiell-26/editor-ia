// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { RemoveBackgroundView } from './RemoveBackgroundView';

const U2NETP: ModelInfo = {
  id: 'u2netp',
  capability: 'remove-background',
  purpose: 'Recorta el sujeto de una foto generando su recorte con transparencia.',
  bytes: 4_574_861,
  downloaded: false,
  license: { id: 'apache-2.0', detail: 'Pesos de U²-Net (Apache-2.0).', url: '' },
  sourceUrl: 'https://github.com/danielgatis/rembg',
};

function renderView(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const service = createFakeService();
  configure(service);
  const onNavigate = vi.fn();
  render(
    <ProjectProvider service={service}>
      <RemoveBackgroundView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Quitar fondo · pre-check del modelo local', () => {
  it('con el modelo ausente ofrece descargarlo y bloquea la ejecución', async () => {
    renderView((service) => {
      service.listModels = async () => [U2NETP];
    });

    expect((await screen.findAllByText(/Falta descargar/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Descargar modelo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Quitar fondo$/i })).toHaveProperty(
      'disabled',
      true,
    );
    // El requisito de ONNX Runtime queda declarado, no prometido.
    expect(screen.getByText(/onnxruntime\.dll/i)).toBeTruthy();
  });

  it('descarga el modelo desde la vista y pasa a estado listo', async () => {
    const { service } = renderView((fake) => {
      fake.listModels = async () => [U2NETP];
      fake.downloadModel = async (id) => ({ ...U2NETP, id, downloaded: true });
    });
    const download = vi.spyOn(service, 'downloadModel');

    fireEvent.click(await screen.findByRole('button', { name: /Descargar modelo/i }));

    await waitFor(() => expect(download).toHaveBeenCalledWith('u2netp'));
    expect(await screen.findByText(/u2netp listo/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Descargar modelo/i })).toBeNull();
  });

  it('si el modelo ya está descargado no ofrece descarga', async () => {
    renderView((service) => {
      service.listModels = async () => [{ ...U2NETP, downloaded: true }];
    });

    expect(await screen.findByText(/u2netp listo/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Descargar modelo/i })).toBeNull();
  });

  it('declara el error de consulta con reintento y enlace a Ajustes', async () => {
    const { onNavigate } = renderView((service) => {
      service.listModels = async () => {
        throw new Error('el gestor de modelos no respondió');
      };
    });

    expect(await screen.findByText(/No se pudo consultar el modelo local/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Abrir Ajustes/i }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
    expect(screen.getByRole('button', { name: /^Quitar fondo$/i })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
