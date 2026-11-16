// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewErrorBoundary } from './ViewErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Bomb({ message }: { readonly message: string }): ReactNode {
  throw new Error(message);
}

describe('ViewErrorBoundary · mensajes seguros para la UI', () => {
  it('no expone rutas absolutas del equipo en la pantalla de recuperación', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const secretPath = 'D:\\Usuarios\\ofici\\AppData\\credenciales\\token.txt';
    render(
      <ViewErrorBoundary resetKey="editor">
        <Bomb message={`No se pudo leer ${secretPath}`} />
      </ViewErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('token.txt');
    expect(alert.textContent).not.toContain('D:\\Usuarios');
    expect(alert.textContent).not.toContain('credenciales\\');
  });

  it('trunca mensajes excesivamente largos', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ViewErrorBoundary resetKey="editor">
        <Bomb message={'x'.repeat(900)} />
      </ViewErrorBoundary>,
    );
    const pre = screen.getByRole('alert').querySelector('pre');
    expect(pre?.textContent?.length).toBe(400);
  });
});
