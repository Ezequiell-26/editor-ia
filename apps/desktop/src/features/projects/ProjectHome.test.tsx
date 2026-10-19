// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe('Projects', () => {
  it('explica que no hay proyectos y pide un nombre antes de crear', async () => {
    render(<App service={createFakeService()} />);
    const main = screen.getByRole('main');
    expect(main.textContent).toMatch(/No hay proyectos abiertos/i);
    fireEvent.click(within(main).getByRole('button', { name: /Crear y elegir ubicación/i }));
    await waitFor(() => expect(screen.getByText(/Poné un nombre/i)).toBeTruthy());
    expect(main.textContent).toMatch(/No hay proyectos abiertos/i);
  });

  it('crea un proyecto, lo recuerda y permite volver a abrirlo desde recientes', async () => {
    const service = createFakeService();
    render(<App service={service} />);
    const main = screen.getByRole('main');
    fireEvent.change(within(main).getByRole('textbox', { name: /nombre/i }), {
      target: { value: 'Mi obra' },
    });
    fireEvent.click(within(main).getByRole('button', { name: /Crear y elegir ubicación/i }));
    await waitFor(() => expect(screen.getByRole('main').textContent).toContain('Mi obra'));
    fireEvent.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: /Proyectos/ }),
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
      expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Exportar MP4/),
    );
    fireEvent.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: /Proyectos/ }),
    );
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('Proyecto abierto');
    expect(main.textContent).toMatch(/1920×1080/);
    expect(main.textContent).toMatch(/30 fps/);
    expect(within(main).getByRole('button', { name: /Guardar como/i })).toBeTruthy();
  });

  it('permite elegir vertical 9:16 antes de crear', async () => {
    render(<App service={createFakeService()} />);
    const main = screen.getByRole('main');
    const vertical = within(main).getByRole('radio', { name: /Vertical 9:16/i }) as HTMLInputElement;
    fireEvent.click(vertical);
    expect(vertical.checked).toBe(true);
    expect(main.textContent).toContain('1080×1920');
  });
});
