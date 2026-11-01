// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptionFontField } from './CaptionFontField';

afterEach(() => cleanup());

describe('CaptionFontField', () => {
  it('muestra las fuentes instaladas y propaga un cambio válido', () => {
    const onChange = vi.fn();
    render(
      <CaptionFontField
        value="Inter"
        fonts={['Arial', 'Inter', 'Segoe UI']}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Fuente de subtítulos') as HTMLInputElement;
    expect(input.value).toBe('Inter');
    expect(input.getAttribute('list')).toBe('caption-system-fonts');
    const datalist = screen.getByTestId('caption-fonts');
    expect([...datalist.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'Arial',
      'Inter',
      'Segoe UI',
    ]);
    fireEvent.change(input, { target: { value: 'Arial' } });
    expect(onChange).toHaveBeenCalledWith('Arial');
  });

  it('no propaga un valor vacío y omite el datalist sin fuentes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CaptionFontField value="Inter" fonts={[]} onChange={onChange} />,
    );
    expect(screen.queryByTestId('caption-fonts')).toBeNull();
    fireEvent.change(screen.getByLabelText('Fuente de subtítulos'), {
      target: { value: '   ' },
    });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<CaptionFontField value="Inter" fonts={['Arial']} onChange={onChange} />);
    expect(screen.getByTestId('caption-fonts')).toBeTruthy();
  });
});
