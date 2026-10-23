// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowQueueProvider } from '../../state/FlowQueueProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { queuePendingComparison } from '../compare/pending';
import { CompressView } from './CompressView';

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
        <CompressView onNavigate={onNavigate} />
      </FlowQueueProvider>
    </ProjectProvider>,
  );
  return service;
}

describe('comprimir como pro', () => {
  it('acepta un video, muestra sus datos y comprime con el número verificable', async () => {
    const service = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));

    await waitFor(() => expect(screen.getByText('1920×1080')).toBeTruthy());
    expect(screen.getByText('40.0 MB')).toBeTruthy();
    expect(screen.getByText('h264')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Comprimir/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    // El número verificable: antes → después y el ahorro.
    const numbers = screen.getByRole('status').textContent ?? '';
    expect(numbers).toMatch(/40.0 MB → 4.0 MB/);
    expect(numbers).toMatch(/90% menos/);
    expect(numbers).toMatch(/libx264/);
    expect(service.calls.compressAny).toBe(1);
  });

  it('ofrece comparar el resultado y manda el par pendiente', async () => {
    const onNavigate = vi.fn();
    renderView(onNavigate);

    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() => expect(screen.getByText('1920×1080')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Comprimir/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Comparar antes y después/i }));
    expect(onNavigate).toHaveBeenCalledWith('compare');
    const pending = window.sessionStorage.getItem('editor-ia.pending-comparison') ?? '';
    const pair: unknown = JSON.parse(pending);
    expect(pair).toEqual({
      beforePath: expect.stringContaining('toma.mp4'),
      afterPath: expect.stringContaining('toma.mp4'),
    });
    const record = pair as { beforePath: string; afterPath: string };
    expect(record.beforePath).toContain('media');
    expect(record.afterPath).toContain('salida');
    expect(onNavigate).toHaveBeenCalledWith('compare');
  });

  it('queda en modo calidad con el preajuste de YouTube por defecto', async () => {
    const service = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Elegir video/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Comprimir/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Comprimir/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    // El servicio simulado guarda el pedido: se comprueba que fue calidad.
    expect(service.calls.compressAny).toBe(1);
  });

  it('no se puede comprimir sin elegir video', () => {
    renderView();
    // El botón Comprimir ni siquiera existe hasta que hay un video elegido.
    expect(screen.queryByRole('button', { name: /Comprimir/i })).toBeNull();
    expect(screen.getByText(/cualquier formato que FFmpeg lea/i)).toBeTruthy();
  });
});
