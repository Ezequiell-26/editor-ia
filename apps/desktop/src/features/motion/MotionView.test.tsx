// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

function nav(label: string): void {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const direct = within(navigation).queryByRole('button', { name: label });
    if (direct) {
      fireEvent.click(direct);
      return;
    }
    const close = within(navigation).queryByRole('button', {
      name: /Cerrar herramientas avanzadas/i,
    });
    if (close) fireEvent.click(close);
    const more = within(navigation).queryByRole('button', { name: /Más herramientas/i });
    if (more) fireEvent.click(more);
    const advanced = within(navigation).queryByRole('button', { name: label });
    if (advanced) {
      fireEvent.click(advanced);
      return;
    }
  }
  throw new Error(`No se encontró la vista ${label} en el sidebar`);
}

async function createProject(name = 'Motion QA'): Promise<void> {
  nav('Proyectos');
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(() => expect(screen.getByRole('main').textContent).toMatch(/Timeline vacía|Timeline 01/), {
    timeout: 10_000,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('vista Motion', () => {
  it('muestra el panel de escena 3D', async () => {
    render(<App service={createFakeService()} />);
    await createProject('3D QA');
    nav('Motion');
    expect(
      await screen.findByRole('heading', { name: /Escena 3D/i }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generar video 3D/i })).toBeTruthy();
    expect(screen.getByLabelText(/Previsualización de la escena 3D/i)).toBeTruthy();
  }, 20_000);

  it('muestra el panel de personaje 2D', async () => {
    render(<App service={createFakeService()} />);
    await createProject('Rig QA');
    nav('Motion');
    expect(
      await screen.findByRole('heading', { name: /Personaje 2D/i }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generar video 2D/i })).toBeTruthy();
    expect(screen.getByLabelText(/Previsualización del personaje 2D/i)).toBeTruthy();
    const rigCard = screen.getByRole('heading', { name: /Personaje 2D/i }).closest('.card') as HTMLElement;
    fireEvent.change(within(rigCard).getByLabelText('Animación'), { target: { value: 'reach' } });
    const targetX = (await screen.findByLabelText(/Objetivo X/i)) as HTMLInputElement;
    const targetY = screen.getByLabelText(/Objetivo Y/i) as HTMLInputElement;
    expect(targetX.value).toBe('0.82');
    expect(targetY.value).toBe('0.28');
    fireEvent.change(targetX, { target: { value: '0.6' } });
    expect((screen.getByLabelText(/Objetivo X/i) as HTMLInputElement).value).toBe('0.6');
    fireEvent.change(within(rigCard).getByLabelText('Animación'), { target: { value: 'idle' } });
    await waitFor(() => expect(screen.queryByLabelText(/Objetivo X/i)).toBeNull());
  }, 20_000);

  it('muestra el panel 2.5D y deshabilita la creación sin materiales', async () => {
    render(<App service={createFakeService()} />);
    await createProject('Parallax QA');
    nav('Motion');
    expect(
      await screen.findByRole('heading', { name: /Parallax y profundidad/i }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByText(/Importá al menos una imagen o video/i)).toBeTruthy();
  }, 20_000);

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
    // El Inspector vive en un chunk diferido: hay que esperar a que monte.
    const title = (await screen.findByLabelText('Título', {}, { timeout: 10_000 })) as HTMLInputElement;
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
    expect(await screen.findByText(/Sugerencia de auto/i)).toBeTruthy();
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
