// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe('menú de perfil', () => {
  it('abre el menú en un portal, fuera del sidebar que lo recortaba', () => {
    const { container } = render(<ProfileMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    const menu = screen.getByRole('menu', { name: 'Menú de perfil' });
    // El sidebar tiene overflow-y: auto: si el menú viviera adentro, se vería
    // cortado a los 40 px del rail.
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.classList.contains('portaled')).toBe(true);
  });

  it('se ancla al botón con coordenadas de viewport', () => {
    render(<ProfileMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    const menu = screen.getByRole('menu', { name: 'Menú de perfil' });
    expect(menu.style.left).toBe('8px');
    expect(Number.parseInt(menu.style.bottom, 10)).toBeGreaterThan(0);
  });

  it('cierra al hacer clic afuera y con Escape', () => {
    render(<ProfileMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    expect(screen.queryByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('no cierra al hacer clic dentro del menú', () => {
    render(<ProfileMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    const menu = screen.getByRole('menu', { name: 'Menú de perfil' });
    fireEvent.pointerDown(menu);
    expect(screen.queryByRole('menu')).toBeTruthy();
  });

  it('permite editar el nombre', () => {
    render(<ProfileMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Editar foto y nombre/ }));
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByLabelText('Rol o especialidad')).toBeTruthy();
  });

  it('navega a otra vista y cierra el menú', () => {
    const onSelect = vi.fn();
    render(<ProfileMenu onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Perfil de/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Proyectos/ }));
    expect(onSelect).toHaveBeenCalledWith('projects');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
