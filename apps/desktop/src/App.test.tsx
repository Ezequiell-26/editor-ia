// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { App } from './App';
import { createFakeService, readyAsset } from './test/fake-service';
import { addAsset, addClipFromAsset, ensureDelivery } from './state/project-actions';

function renderApp() {
  const service = createFakeService();
  render(<App service={service} />);
  return service;
}

function nav(label: string): void {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: label }));
}

async function createProject(name = 'Obra de prueba'): Promise<void> {
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(() => {
    expect(screen.getByRole('main').textContent).toContain(name);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('shell de Editor IA', () => {
  it('usa toda la pantalla con menús profesionales y un rail de iconos sin marca', () => {
    renderApp();
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('heading', { level: 1 })).toBeNull();
    expect(banner.textContent).not.toMatch(/Editor IA/);
    for (const menu of ['Archivo', 'Editar', 'Ver', 'Reproducción', 'Herramientas', 'Ayuda']) {
      expect(within(banner).getByRole('button', { name: menu })).toBeTruthy();
    }
    const navigation = screen.getByRole('navigation', { name: /vistas/i });
    expect(
      [...navigation.querySelectorAll('ul button')].map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Proyectos',
      'Director',
      'Producción',
      'Fábrica',
      'Editor',
      'Guion',
      'Medios',
      'Descargar',
      'Convertir',
      'Aprender',
      'MCP',
      'Ajustes',
    ]);
    expect(
      within(navigation).getByRole('button', { name: /Proyectos/ }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('button', { name: /Proyectos/ }).getAttribute('data-tooltip'),
    ).toMatch(/Crear, abrir/i);
  });

  it('abre los menús y ejecuta acciones reales', async () => {
    const service = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Archivo' }));
    expect(screen.getByRole('menuitem', { name: /Abrir proyecto/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Abrir proyecto/i }));
    await waitFor(() => expect(service.calls.open).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ajustes' }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Apariencia'));
  });

  it('abre el descargador, analiza una URL y la importa con el servicio simulado', async () => {
    renderApp();
    await createProject('Obra descarga');
    nav('Descargar');
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Motor de descargas');
    const url = within(main).getByRole('textbox', { name: /URL para descargar/i });
    fireEvent.change(url, { target: { value: 'https://example.com/video' } });
    fireEvent.click(within(main).getByRole('button', { name: /Analizar/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Video de prueba'));
    expect(screen.getByRole('main').textContent).toContain('4320p · 8K');
    fireEvent.click(screen.getByRole('checkbox', { name: /Tengo derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Descargar e importar/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Ver 1 archivo(s) en Medios'));
    expect(screen.getByRole('main').textContent).toContain('video.mp4');
  });

  it('sin runtime nativo avisa y deshabilita la creación', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.textContent).toMatch(/Abrí la app de escritorio/i);
    expect((within(main).getByRole('button', { name: /Crear y elegir ubicación/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('crea un proyecto, navega al editor y muestra una timeline honestamente vacía', async () => {
    const service = renderApp();
    await createProject('Corte vertical');
    expect(service.calls.create).toBe(1);
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Corte vertical');
    expect(main.textContent).toContain('Timeline vacía');
    expect(main.textContent).toContain('Exportar MP4');
    expect(main.textContent).toMatch(/Vista previa aproximada/i);
    expect(
      (within(main).getByRole('button', { name: /Exportar MP4/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(main).getByRole('button', { name: /Exportar MP4/i }).getAttribute('title')).toMatch(
      /Montá al menos un clip/i,
    );
  });

  it('abre un proyecto existente y permite guardarlo', async () => {
    const service = renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Abrir proyecto/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Exportar MP4/));
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));
    await waitFor(() => expect(service.calls.save).toBe(1));
    expect(screen.getByRole('contentinfo').textContent).toMatch(/Guardado/i);
  });

  it('declara un guardado fallido sin fingir éxito', async () => {
    const service = renderApp();
    await createProject('Obra con fallo');
    service.setSaveFailure('disco lleno');
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/disco lleno/i);
    });
    expect(screen.getByRole('banner').textContent).not.toMatch(/Guardado/i);
  });

  it('deshace y rehace un cambio de pista', async () => {
    renderApp();
    await createProject('Obra undo');
    const main = screen.getByRole('main');
    expect(within(main).queryByText('V1')).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: /Agregar pista/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).getByText('V1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Deshacer/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).queryByText('V1')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Rehacer/i }));
    await waitFor(() => expect(within(screen.getByRole('main')).getByText('V1')).toBeTruthy());
  });

  it('muestra el proveedor simulado y la lista de escenas en Guion', async () => {
    renderApp();
    await createProject('Obra guion');
    nav('Guion');
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Guion y escenas'));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Simulado'));
    expect(screen.getByRole('main').textContent).toMatch(/No hay escenas|escena/i);
    expect(
      (within(screen.getByRole('main')).getByRole('button', { name: /Generar guion/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Producción muestra el flujo de video automático y sus pasos', async () => {
    renderApp();
    await createProject('Obra producción');
    nav('Producción');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('De guion a video'));
    expect(main.textContent).toContain('Guion y escenas');
    expect(main.textContent).toContain('Generar video automático');
    expect(main.textContent).toMatch(/Faltan escenas de guion/i);
  });

  it('Medios muestra la biblioteca vacía y el consentimiento de derechos', async () => {
    renderApp();
    await createProject('Obra medios');
    nav('Medios');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('No hay assets todavía'));
    expect(main.textContent).toMatch(/Confirmo que tengo derechos/i);
    expect(within(main).getByRole('button', { name: /Importar medios/i })).toBeTruthy();
  });

  it('Ajustes lista las herramientas detectadas y el alcance real', async () => {
    renderApp();
    nav('Ajustes');
    const main = screen.getByRole('main');
    await waitFor(() => expect(main.textContent).toContain('FFmpeg'));
    expect(main.textContent).toMatch(/Render MP4 H\.264\/AAC/);
    expect(main.textContent).toMatch(/Remotion queda fuera/i);
    expect(main.textContent).toMatch(/Administrador de credenciales de Windows/i);
  });

  it('abre el diálogo de exportación con un clip y los perfiles del proyecto', async () => {
    const service = createFakeService();
    const base = ensureDelivery(createEmptyProject('Obra export', '2025-01-01T00:00:00Z'));
    const asset = readyAsset();
    const seeded = addClipFromAsset(addAsset(base, asset), asset, {}).project;
    const seededOpened = {
      project: seeded,
      label: 'export.editoria.json',
      path: 'C:\\tmp\\export.editoria.json',
      root: 'C:\\tmp',
    };
    service.createProject = async () => seededOpened;
    service.current = seededOpened;
    render(<App service={service} />);
    await createProject('Obra export');
    fireEvent.click(screen.getByRole('button', { name: /Exportar MP4/i }));
    const dialog = screen.getByRole('dialog', { name: /Render MP4 verificado/i });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getAllByText(/YouTube 1080p/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /Elegir destino y exportar/i })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Elegir carpeta y exportar lote/i })).toBeTruthy();
  });
});
