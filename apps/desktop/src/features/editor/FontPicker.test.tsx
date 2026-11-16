// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontPicker, normalizeFontQuery, rankFonts } from './FontPicker';

const FONTS = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Segoe UI',
  'Verdana',
];

afterEach(cleanup);

describe('normalizeFontQuery', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(normalizeFontQuery('ÁÉÍÓÚ')).toBe('aeiou');
    expect(normalizeFontQuery('  Segoe  ')).toBe('segoe');
  });
});

describe('rankFonts', () => {
  it('rankea prefijo > palabra > substring', () => {
    const ranked = rankFonts('arial', FONTS).map((entry) => entry.font);
    expect(ranked[0]).toBe('Arial');
    expect(ranked).toContain('Arial Black');
  });

  it('encuentra por palabra intermedia y por acento', () => {
    const byWord = rankFonts('black', FONTS).map((entry) => entry.font);
    expect(byWord).toEqual(['Arial Black']);
    const accented = rankFonts('comic', ['Comic Sans MS']).map((e) => e.font);
    expect(accented).toEqual(['Comic Sans MS']);
  });

  it('devuelve todo con consulta vacía y nada sin coincidencia', () => {
    expect(rankFonts('', FONTS)).toHaveLength(FONTS.length);
    expect(rankFonts('zzz', FONTS)).toHaveLength(0);
  });
});

describe('FontPicker', () => {
  it('filtra, navega con teclado y elige una fuente', () => {
    const onChange = vi.fn();
    render(<FontPicker value="Arial" fonts={FONTS} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'geo' } });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Georgia']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Georgia');
  });

  it('renderiza cada opción en su propia familia', () => {
    render(<FontPicker value="" fonts={['Georgia']} onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));
    const option = screen.getByRole('option');
    expect(option.style.fontFamily).toContain('Georgia');
  });
});
