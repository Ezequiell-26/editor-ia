// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowQueueProvider } from '../../state/FlowQueueProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { SharpenView } from './SharpenView';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function renderView(onNavigate: (id: string) => void = vi.fn()) {
  const service = createFakeService();
  render(
    <ProjectProvider service={service}>
      <FlowQueueProvider>
        <SharpenView onNavigate={onNavigate} />
      </FlowQueueProvider>
    </ProjectProvider>,
  );
  return service;
}

describe('definición', () => {
  it('muestra las cinco etapas y sus controles sin archivo', () => {
    renderView();
    for (const title of [
      'Limpieza y de-blocking',
      'Escalado Lanczos',
      'Máscara de enfoque',
      'Curva S de micro-contraste',
      'Grano de película',
    ]) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.getByRole('button', { name: /Elegir video/i })).toBeTruthy();
    expect(screen.getByText(/Elegí un video o una imagen para empezar/i)).toBeTruthy();
  });

  it('con un video elegido lista las cinco etapas y el preset 4K pide escalar', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() => expect(screen.getByText('1920×1080')).toBeTruthy());

    for (const title of [
      'Limpieza y de-blocking',
      'Escalado Lanczos',
      'Máscara de enfoque',
      'Curva S de micro-contraste',
      'Grano de película',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: /1080p → 4K/i }));
    await waitFor(() =>
      expect(screen.getByText(/scale=-2:2160:flags=lanczos/)).toBeTruthy(),
    );
    expect(screen.getByText(/Lanczos a 2160p/)).toBeTruthy();
  });

  it('renderiza con la cadena elegida y reporta el antes y el después', async () => {
    const service = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() => expect(screen.getByText('1920×1080')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Aplicar y guardar/i }));
    // El preview WebGL no existe en jsdom y publica su propio aviso; el
    // resultado se busca por su texto, no por el rol compartido.
    await waitFor(() =>
      expect(screen.getByText(/1920×1080 → 3840×2160/)).toBeTruthy(),
    );
    expect(service.calls.sharpenRenders).toBe(1);
  });

  it('no deja renderizar sin ninguna etapa activa', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() => expect(screen.getByText('1920×1080')).toBeTruthy());

    // «Solo limpieza» y luego apagar la limpieza deja la cadena vacía.
    fireEvent.click(screen.getByRole('button', { name: /Solo limpieza/i }));
    const strength = screen.getByRole('slider', { name: /Fuerza de limpieza/i });
    fireEvent.change(strength, { target: { value: '0' } });
    const deblock = screen.getByRole('checkbox', { name: /De-blocking/i });
    fireEvent.click(deblock);

    await waitFor(() =>
      expect(screen.getByText('sin etapas activas')).toBeTruthy(),
    );
    const apply = screen.getByRole('button', { name: /Aplicar y guardar/i });
    expect(apply.hasAttribute('disabled')).toBe(true);
  });
});
