// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewErrorBoundary } from './ViewErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Bomb(): ReactNode {
  throw new Error('el panel explotó');
}

describe('ViewErrorBoundary', () => {
  it('muestra una recuperación clara en vez de dejar la app en blanco', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onHome = vi.fn();
    render(
      <ViewErrorBoundary resetKey="editor" onHome={onHome}>
        <Bomb />
      </ViewErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('La herramienta se detuvo');
    expect(alert.textContent).toContain('el panel explotó');
    fireEvent.click(screen.getByRole('button', { name: /Ir a Inicio/i }));
    expect(onHome).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('se recupera al cambiar de superficie', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Maybe() {
      if (fail) throw new Error('falla transitoria');
      return <p>panel recuperado</p>;
    }
    const { rerender } = render(
      <ViewErrorBoundary resetKey="a">
        <Maybe />
      </ViewErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fail = false;
    rerender(
      <ViewErrorBoundary resetKey="b">
        <Maybe />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('panel recuperado')).toBeTruthy();
  });
});
