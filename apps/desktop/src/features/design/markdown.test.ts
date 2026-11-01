import { describe, expect, it } from 'vitest';
import { parseMarkdown, plainInline } from './markdown';

describe('lector de guías de diseño', () => {
  it('convierte títulos, listas, citas y reglas en bloques', () => {
    const blocks = parseMarkdown(
      ['# Paleta', '', 'Texto con **énfasis** y `código`.', '', '- uno', '- dos', '', '> cita', '', '---'].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Paleta' },
      { kind: 'paragraph', text: 'Texto con énfasis y código.' },
      { kind: 'list', ordered: false, items: ['uno', 'dos'] },
      { kind: 'quote', text: 'cita' },
      { kind: 'rule' },
    ]);
  });

  it('respeta bloques de código y tablas', () => {
    const blocks = parseMarkdown(
      [
        '```css',
        '--accent: #ff385c;',
        '```',
        '',
        '| Token | Uso |',
        '| --- | --- |',
        '| accent | CTA |',
        '| fg | Texto |',
      ].join('\n'),
    );
    expect(blocks[0]).toEqual({ kind: 'code', language: 'css', text: '--accent: #ff385c;' });
    expect(blocks[1]).toEqual({
      kind: 'table',
      headers: ['Token', 'Uso'],
      rows: [
        ['accent', 'CTA'],
        ['fg', 'Texto'],
      ],
    });
  });

  it('limpia enlaces e imágenes sin dejar URLs', () => {
    expect(plainInline('Ver [la guía](https://example.com) y ![logo](x.png)')).toBe(
      'Ver la guía y logo',
    );
  });
});
