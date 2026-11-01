// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDesignSystem } from '../design/design-selection';
import { MotionForm } from './MotionForm';
import { titleCardTemplate } from './templates';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const props = { ...titleCardTemplate.defaults };

describe('paleta de diseño en Motion', () => {
  it('aplica fondo y acento del sistema a los campos de color', () => {
    applyDesignSystem({
      id: 'agentic',
      name: 'Agentic',
      canvas: {
        accent: '#60a5fa',
        accentOn: '#06111f',
        bg: '#0b1020',
        fg: '#f8fafc',
      },
    });
    const onChange = vi.fn();
    render(
      <MotionForm template={titleCardTemplate} props={props} onChange={onChange} />,
    );
    expect(screen.getByText('Agentic')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        background: '#0b1020',
        accent: '#60a5fa',
      }),
    );
  });

  it('no muestra la paleta si no hay un sistema aplicado', () => {
    render(<MotionForm template={titleCardTemplate} props={props} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
  });
});
