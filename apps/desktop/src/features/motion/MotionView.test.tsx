// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

function nav(label: string): void {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', { name: label }),
  );
}

async function createProject(name = 'Motion QA'): Promise<void> {
  nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(() => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Exportar MP4/), {
    timeout: 10_000,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('vista Motion', () => {
  it('agrega un título a la timeline y abre el editor', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    nav('Motion');
    expect(
      await screen.findByRole(
        'heading',
        { name: /Motion graphics/i },
        { timeout: 10_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Título de apertura/i }));
    const preview = screen.getByLabelText(/Previsualización de motion graphics/i);
    expect(preview.querySelectorAll('[data-layer-kind="text"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la timeline/i }));
    expect(
      await screen.findByText(/Gráfico agregado/i, {}, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Motion graphics/i })).toBeNull();
    const title = screen.getByLabelText('Título') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Nuevo título' } });
    expect(title.value).toBe('Nuevo título');
  }, 20_000);

  it('genera props con IA y espera confirmación antes de aplicar', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    nav('Motion');
    const brief = await screen.findByLabelText(/Brief para Motion/i);
    fireEvent.change(brief, { target: { value: 'Un cierre cálido para un tutorial de cocina' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar con IA/i }));
    expect(await screen.findByText(/Sugerencia simulada/i)).toBeTruthy();
    const title = screen.getByLabelText('Título') as HTMLInputElement;
    expect(title.value).toContain('Un cierre cálido');
    expect(screen.getByRole('heading', { name: /Motion graphics/i })).toBeTruthy();
  }, 20_000);

  it('permite cambiar de plantilla y editar props', async () => {
    render(<App service={createFakeService()} />);
    await createProject();
    nav('Motion');
    fireEvent.click(await screen.findByRole('button', { name: /Lower third/i }));
    const name = screen.getByLabelText('Nombre');
    fireEvent.change(name, { target: { value: 'Ana Pérez' } });
    expect((name as HTMLInputElement).value).toBe('Ana Pérez');
    expect(screen.getByLabelText(/Previsualización de motion graphics/i).textContent).toContain(
      'Ana Pérez',
    );
  }, 20_000);
});
