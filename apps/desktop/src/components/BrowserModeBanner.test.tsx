// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_UNAVAILABLE_REASON } from '../services/project-service';
import { BrowserModeBanner } from './BrowserModeBanner';

afterEach(cleanup);

describe('aviso de modo navegador', () => {
  it('explica el modo con el motivo nativo, lo que se puede probar y Ajustes', () => {
    render(<BrowserModeBanner />);
    const note = screen.getByRole('note', { name: /modo navegador/i });
    const text = note.textContent ?? '';
    expect(text).toContain('Estás viendo Olyvia en el navegador');
    expect(text).toContain(NATIVE_UNAVAILABLE_REASON);
    expect(text).toContain('Qué sí podés probar');
    expect(text).toContain('Qué necesita la app de escritorio');
    expect(text).toContain('Ajustes');
  });

  it('muestra el motivo medido del backend cuando existe', () => {
    render(<BrowserModeBanner reason="sin runtime nativo en esta sesión de prueba" />);
    const note = screen.getByRole('note', { name: /modo navegador/i });
    expect(note.textContent).toContain('sin runtime nativo en esta sesión de prueba');
    expect(note.textContent).not.toContain(NATIVE_UNAVAILABLE_REASON);
  });

  it('abre Ajustes desde el botón cuando la app lo permite', () => {
    const open = vi.fn();
    render(<BrowserModeBanner onOpenSettings={open} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir Ajustes/i }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('sin handler no ofrece un botón que no hace nada', () => {
    render(<BrowserModeBanner />);
    expect(screen.queryByRole('button', { name: /Abrir Ajustes/i })).toBeNull();
  });

  it('ignora un motivo vacío y usa el motivo nativo canónico', () => {
    render(<BrowserModeBanner reason="   " />);
    const note = screen.getByRole('note', { name: /modo navegador/i });
    expect(note.textContent).toContain(NATIVE_UNAVAILABLE_REASON);
  });
});
