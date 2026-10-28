import { describe, expect, it } from 'vitest';
import { MAX_MARKER_NOTE } from './index.ts';
import { MarkerSchema } from './markers.ts';

const ID = '4f2b6a1e-8c9d-4e5f-a0b1-c2d3e4f5a6b7';

function marker(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    frame: 30,
    label: 'Intro',
    ...overrides,
  };
}

describe('nota del marcador (MarkerSchema)', () => {
  it('acepta un marcador sin nota porque el campo es opcional', () => {
    const parsed = MarkerSchema.safeParse(marker());
    expect(parsed.success).toBe(true);
  });

  it('acepta un marcador con nota de texto', () => {
    const parsed = MarkerSchema.safeParse(marker({ note: 'Cortar aquí tras la intro' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.note).toBe('Cortar aquí tras la intro');
    }
  });

  it('recorta los espacios de la nota al validar', () => {
    const parsed = MarkerSchema.safeParse(marker({ note: '  revisar audio  ' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.note).toBe('revisar audio');
    }
  });

  it('rechaza una nota más larga que el máximo permitido', () => {
    const long = 'a'.repeat(MAX_MARKER_NOTE + 1);
    expect(MarkerSchema.safeParse(marker({ note: long })).success).toBe(false);
  });

  it('acepta una nota de exactamente el máximo permitido', () => {
    const parsed = MarkerSchema.safeParse(marker({ note: 'a'.repeat(MAX_MARKER_NOTE) }));
    expect(parsed.success).toBe(true);
  });

  it('acepta notas con saltos de línea porque la nota admite varias líneas', () => {
    const parsed = MarkerSchema.safeParse(marker({ note: 'primera idea\nsegunda idea' }));
    expect(parsed.success).toBe(true);
  });
});
