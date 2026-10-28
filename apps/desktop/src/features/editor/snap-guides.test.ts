import { describe, expect, it } from 'vitest';
import { guideCandidates, snapMove } from './snap-guides';

const PROJECT = { width: 1920, height: 1080 };
// Lienzo a la mitad: 1 px de pantalla = 2 px de proyecto.
const CANVAS = { width: 960, height: 540 };

describe('guías de alineación', () => {
  it('ofrece centro, tercios y bordes en ambos ejes', () => {
    const { x, y } = guideCandidates(PROJECT);
    expect(x.map((item) => item.kind)).toEqual(['center', 'third', 'third', 'edge', 'edge']);
    expect(y).toHaveLength(5);
    expect(x[0]!.offset).toBe(0);
    expect(x[1]!.offset).toBe(-320); // 1920/6
    expect(x[4]!.offset).toBe(960); // borde derecho
  });

  it('imanta al centro dentro de la tolerancia', () => {
    const result = snapMove(6, -4, PROJECT, CANVAS);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.guides).toHaveLength(2);
    expect(result.guides[0]).toMatchObject({ axis: 'x', kind: 'center' });
    expect(result.guides[0]!.at).toBe(480); // centro del lienzo
  });

  it('imanta a los tercios y devuelve la línea en píxeles del lienzo', () => {
    const result = snapMove(318, 0, PROJECT, CANVAS);
    expect(result.offsetX).toBe(320);
    const third = result.guides.find((guide) => guide.kind === 'third');
    expect(third?.at).toBe(640); // 2/3 de 960
  });

  it('no mueve nada si está fuera de la tolerancia', () => {
    const result = snapMove(100, 50, PROJECT, CANVAS);
    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(50);
    expect(result.guides).toHaveLength(0);
  });

  it('con el imán apagado no ajusta ni dibuja guías', () => {
    const result = snapMove(4, 3, PROJECT, CANVAS, false);
    expect(result.offsetX).toBe(4);
    expect(result.offsetY).toBe(3);
    expect(result.guides).toHaveLength(0);
  });

  it('la tolerancia se mide en pantalla, no en el proyecto', () => {
    // 8 px de pantalla con factor 0.5 son 16 px de proyecto.
    const inside = snapMove(15, 0, PROJECT, CANVAS);
    expect(inside.offsetX).toBe(0);
    const outside = snapMove(17, 0, PROJECT, CANVAS);
    expect(outside.offsetX).toBe(17);
  });

  it('el borde izquierdo también imanta', () => {
    const result = snapMove(-955, 0, PROJECT, CANVAS);
    expect(result.offsetX).toBe(-960);
    const edge = result.guides.find((guide) => guide.kind === 'edge');
    expect(edge?.at).toBe(0);
  });
});
