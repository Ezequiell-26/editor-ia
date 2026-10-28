// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubTabs } from './HubTabs';

afterEach(cleanup);

const tabs = [
  { id: 'a', label: 'Primera' },
  { id: 'b', label: 'Segunda' },
  { id: 'c', label: 'Tercera' },
] as const;

describe('HubTabs', () => {
  it('marca el activo y cambia con click', () => {
    const onChange = vi.fn();
    render(<HubTabs tabs={tabs} active="a" onChange={onChange} ariaLabel="Prueba" />);
    const first = screen.getByRole('tab', { name: 'Primera' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.click(screen.getByRole('tab', { name: 'Segunda' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('navega con flechas, Home y End sin salir del tablist', () => {
    const onChange = vi.fn();
    render(<HubTabs tabs={tabs} active="a" onChange={onChange} ariaLabel="Prueba" />);
    const first = screen.getByRole('tab', { name: 'Primera' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Segunda' }));

    fireEvent.keyDown(first, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(first, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
});
