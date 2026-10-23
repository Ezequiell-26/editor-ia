// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { ConvertView } from './ConvertView';

const NOW = '2026-10-20T00:00:00.000Z';

afterEach(() => {
  cleanup();
});

function renderConvert() {
  const base = ensureDelivery(createEmptyProject('Convertir', NOW));
  const project = addAsset(base, readyAsset());
  const service = createFakeService();
  return render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'convertir.editoria.json',
          path: 'C:\\tester\\convertir.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ConvertView onNavigate={() => {}} />
    </ProjectProvider>,
  );
}

describe('ConvertView · caja de herramientas', () => {
  it('muestra las cinco pestañas de herramientas', () => {
    const view = renderConvert();
    const tabs = view.container.querySelectorAll('.convert-tools .tool-tabs button');
    expect(tabs).toHaveLength(5);
    const labels = Array.from(tabs).map((tab) => tab.textContent);
    expect(labels).toEqual([
      'Ninguna',
      'Unir videos',
      'Recortar',
      'Marca de agua',
      'Metadatos',
    ]);
  });

  it('la pestaña Unir exige dos videos y lista los del proyecto', () => {
    const view = renderConvert();
    fireEvent.click(screen.getByText('Unir videos'));
    const button = screen.getByRole('button', { name: /Unir 0 video/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const rows = view.container.querySelectorAll('.tool-asset-list .convert-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('la pestaña Recortar pide video y tiempos', () => {
    const view = renderConvert();
    fireEvent.click(screen.getByText('Recortar'));
    expect(screen.getByLabelText('Desde (segundos)')).toBeTruthy();
    expect(screen.getByLabelText('Hasta (segundos)')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Recortar' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('la pestaña Marca de agua pide texto y posición', () => {
    const view = renderConvert();
    fireEvent.click(screen.getByText('Marca de agua'));
    expect(screen.getByPlaceholderText('@tu-canal')).toBeTruthy();
    expect(screen.getByLabelText('Posición')).toBeTruthy();
  });

  it('la pestaña Metadatos pide archivo y tres campos', () => {
    const view = renderConvert();
    fireEvent.click(screen.getByText('Metadatos'));
    expect(screen.getByLabelText('Título')).toBeTruthy();
    expect(screen.getByLabelText('Artista')).toBeTruthy();
    expect(screen.getByLabelText('Comentario')).toBeTruthy();
  });
});

describe('ConvertView · lote, compresión y formatos', () => {
  it('ofrece los formatos ampliados agrupados', () => {
    renderConvert();
    const select = screen.getByLabelText('Formato') as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain('mkv');
    expect(values).toContain('hevc');
    expect(values).toContain('avi');
    expect(values).toContain('opus');
    expect(values).toContain('flac');
    expect(values).toContain('tiff');
  });

  it('convierte el lote por el comando de lote y muestra el ahorro', async () => {
    const view = renderConvert();
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar compatibles/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Convertir/ }));
    await screen.findByText(/de 1 listos/);
    const results = view.container.querySelector('.convert-results');
    expect(results?.textContent).toContain('75% menos');
    expect(results?.textContent).toContain('libx264');
  });

  it('comprime con tamaño objetivo usando el modo tamaño', async () => {
    const view = renderConvert();
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar compatibles/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Por tamaño' }));
    fireEvent.change(screen.getByLabelText('Tamaño objetivo por video (MB)'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Comprimir/ }));
    await screen.findByText(/de 1 listos/);
    const results = view.container.querySelector('.convert-results');
    expect(results?.textContent).toMatch(/4\.1 kB/);
    expect(results?.textContent).toContain('h264_nvenc');
    expect(results?.textContent).toMatch(/\d+% menos/);
  });

  it('expone encoder y mejoras, y las manda al lote', async () => {
    renderConvert();
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar compatibles/ }));
    fireEvent.change(screen.getByLabelText('Encoder'), { target: { value: 'software' } });
    fireEvent.click(screen.getByText('Reducir ruido'));
    fireEvent.click(screen.getByText('Normalizar audio (−16 LUFS)'));
    fireEvent.click(screen.getByRole('button', { name: /^Convertir/ }));
    await screen.findByText(/de 1 listos/);
    // El fake ignora las opciones, pero el camino completo corre sin errores.
    expect(screen.queryByText(/la conversión falló/)).toBeNull();
  });
});
