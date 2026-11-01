// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { DesignImageGenerator } from './DesignImageGenerator';

function renderImageGenerator(
  onNavigate = vi.fn(),
  initialPrompt: { text: string; key: number } | null = null,
) {
  const project = createEmptyProject('Imágenes', '2026-10-29T00:00:00.000Z');
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'imagenes.editoria.json',
          path: 'C:\\tester\\imagenes.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <DesignImageGenerator initialPrompt={initialPrompt} onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DesignImageGenerator', () => {
  it('exige un prompt mínimo antes de llamar al proveedor', () => {
    const { service } = renderImageGenerator();
    const generate = vi.spyOn(service, 'generateDesignImage');
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    expect(screen.getByRole('alert').textContent).toContain('al menos 8 caracteres');
    expect(generate).not.toHaveBeenCalled();
  });

  it('genera con Pollinations y muestra el tamaño real', async () => {
    const { service } = renderImageGenerator();
    const generate = vi.spyOn(service, 'generateDesignImage');
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Fondo abstracto editorial en azul cobalto con grano sutil' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith({
      prompt: 'Fondo abstracto editorial en azul cobalto con grano sutil',
      source: 'pollinations',
      model: '',
      width: 512,
      height: 512,
      seed: null,
      approvedCost: false,
    });
    const image = await screen.findByRole('img', { name: /Imagen generada para/i });
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getAllByText(/512×512/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pollinations · auto/)).toBeTruthy();
  });

  it('cambia al proveedor configurado con tamaños propios', async () => {
    const { service } = renderImageGenerator();
    const generate = vi.spyOn(service, 'generateDesignImage');
    fireEvent.click(screen.getByRole('radio', { name: /Proveedor configurado/i }));
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Póster suizo con tipografía integrada y paleta cobalto' },
    });
    const sizeSelect = screen.getByLabelText('Tamaño') as HTMLSelectElement;
    expect(sizeSelect.selectedOptions[0]?.textContent).toBe('1024×1024');
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'gateway', model: '', width: 1024, height: 1024 }),
    );
  });

  it('rechaza una semilla que no es numérica', async () => {
    const { service } = renderImageGenerator();
    const generate = vi.spyOn(service, 'generateDesignImage');
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Retrato cinematográfico con luz suave de estudio' },
    });
    fireEvent.change(screen.getByLabelText('Semilla'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    expect(screen.getByRole('alert').textContent).toContain('número entero');
    expect(generate).not.toHaveBeenCalled();
  });

  it('muestra el error real del proveedor', async () => {
    const { service } = renderImageGenerator();
    vi.spyOn(service, 'generateDesignImage').mockRejectedValueOnce(
      new Error('Pollinations rechazó la imagen (HTTP 402): límite gratuito alcanzado'),
    );
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Fondo de prueba para el límite del servicio' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('límite gratuito alcanzado');
  });

  it('guarda, envía a Medios y monta en la timeline', async () => {
    const { service, onNavigate } = renderImageGenerator();
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Miniatura de video con luz de estudio y fondo desenfocado' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generar imagen/i }));
    await screen.findByRole('img', { name: /Imagen generada para/i });

    const save = vi.spyOn(service, 'saveDesignImage');
    fireEvent.click(screen.getByRole('button', { name: /Guardar imagen/i }));
    await screen.findByText(/Guardada en/);
    expect(save).toHaveBeenCalledWith(expect.any(String), 'imagen-pollinations.png');

    const stage = vi.spyOn(service, 'stageDesignMedia');
    const importMedia = vi.spyOn(service, 'importMediaPaths');
    fireEvent.click(screen.getByRole('button', { name: /Enviar a Medios/i }));
    await screen.findByText(/En Medios como/);
    expect(stage).toHaveBeenCalledWith(expect.any(String), 'png');
    expect(importMedia).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['media/diseno.png'] }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Montar en la timeline/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('acepta un prompt inicial desde la biblioteca', () => {
    renderImageGenerator(vi.fn(), { text: 'Prompt de la plantilla', key: 1 });
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(
      'Prompt de la plantilla',
    );
  });
});
