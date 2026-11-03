// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { UpscaleView } from './UpscaleView';

const REAL_ESRGAN: ModelInfo = {
  id: 'real-esrgan-x4plus',
  capability: 'upscale',
  purpose: 'Agranda una imagen ×4 recuperando detalle (Real-ESRGAN).',
  bytes: 69_895_977,
  downloaded: false,
  license: {
    id: 'bsd-3-clause',
    detail: 'Real-ESRGAN-x4plus exportado por Qualcomm AI Hub (BSD-3-Clause).',
    url: '',
  },
  sourceUrl: 'https://huggingface.co/qualcomm/Real-ESRGAN-x4plus',
};

function renderView(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const service = createFakeService();
  configure(service);
  const onNavigate = vi.fn();
  render(
    <ProjectProvider service={service}>
      <UpscaleView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Upscale · pre-check del modelo local', () => {
  it('con el modelo ausente ofrece descargarlo y bloquea la ejecución', async () => {
    renderView((service) => {
      service.listModels = async () => [REAL_ESRGAN];
    });

    expect((await screen.findAllByText(/Falta descargar/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Descargar modelo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Agrandar ×4$/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/onnxruntime\.dll/i)).toBeTruthy();
  });

  it('descarga el modelo desde la vista y pasa a estado listo', async () => {
    const { service } = renderView((fake) => {
      fake.listModels = async () => [REAL_ESRGAN];
      fake.downloadModel = async (id) => ({ ...REAL_ESRGAN, id, downloaded: true });
    });
    const download = vi.spyOn(service, 'downloadModel');

    fireEvent.click(await screen.findByRole('button', { name: /Descargar modelo/i }));

    await waitFor(() => expect(download).toHaveBeenCalledWith('real-esrgan-x4plus'));
    expect(await screen.findByText(/real-esrgan-x4plus listo/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Descargar modelo/i })).toBeNull();
  });

  it('si el modelo ya está descargado no ofrece descarga', async () => {
    renderView((service) => {
      service.listModels = async () => [{ ...REAL_ESRGAN, downloaded: true }];
    });

    expect(await screen.findByText(/real-esrgan-x4plus listo/i)).toBeTruthy();
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
  });
});
