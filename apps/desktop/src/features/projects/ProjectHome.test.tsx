// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

function goProjects(): HTMLElement {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', { name: /Proyectos/ }),
  );
  return screen.getByRole('main');
}

describe('Projects', () => {
  it('explica que no hay proyectos y pide un nombre antes de crear', async () => {
    render(<App service={createFakeService()} />);
    const main = goProjects();
    expect(main.textContent).toMatch(/No hay proyectos abiertos/i);
    fireEvent.click(within(main).getByRole('button', { name: /Crear y elegir ubicación/i }));
    await waitFor(() => expect(screen.getByText(/Poné un nombre/i)).toBeTruthy());
    expect(main.textContent).toMatch(/No hay proyectos abiertos/i);
  });

  it('crea un proyecto, lo recuerda y permite volver a abrirlo desde recientes', async () => {
    const service = createFakeService();
    render(<App service={service} />);
    const main = goProjects();
    fireEvent.change(within(main).getByRole('textbox', { name: /nombre/i }), {
      target: { value: 'Mi obra' },
    });
    fireEvent.click(within(main).getByRole('button', { name: /Crear y elegir ubicación/i }));
    await waitFor(
      () => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/),
      { timeout: 5000 },
    );
    fireEvent.click(
      within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', { name: /Proyectos/ }),
    );
    const projects = screen.getByRole('main');
    expect(projects.textContent).toContain('Proyecto abierto');
    expect(projects.textContent).toContain('Mi obra');
    const recents = within(projects).getAllByRole('button', { name: /Mi obra/i });
    expect(recents.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem('editoria.recent.v1')).toContain('mi-obra.editoria.json');
  });

  it('abre un proyecto existente y muestra sus métricas al volver a Projects', async () => {
    render(<App service={createFakeService()} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir proyecto/i }));
    await waitFor(() =>
      expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/),
    );
    fireEvent.click(
      within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', { name: /Proyectos/ }),
    );
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Proyecto abierto');
    expect(main.textContent).toMatch(/1920×1080/);
    expect(main.textContent).toMatch(/30 fps/);
    expect(within(main).getByRole('button', { name: /Guardar como/i })).toBeTruthy();
  });

  it('permite elegir vertical 9:16 y fps antes de crear', async () => {
    render(<App service={createFakeService()} />);
    const main = goProjects();
    fireEvent.change(within(main).getByLabelText(/^Formato$/i), {
      target: { value: 'vertical' },
    });
    fireEvent.change(within(main).getByLabelText(/^Tasa de frames$/i), {
      target: { value: '25' },
    });
    expect(main.textContent).toContain('1080×1920');
    expect(main.textContent).toContain('9:16');
    expect(main.textContent).toContain('25 fps');
  });

  it('acepta un formato y fps personalizados', () => {
    render(<App service={createFakeService()} />);
    const main = goProjects();
    fireEvent.change(within(main).getByLabelText(/^Formato$/i), {
      target: { value: 'custom' },
    });
    const [width, height] = within(main).getAllByRole('spinbutton');
    fireEvent.change(width!, { target: { value: '1366' } });
    fireEvent.change(height!, { target: { value: '768' } });
    expect(main.textContent).toContain('1366×768');
    expect(main.textContent).toContain('683:384');
  });
});
