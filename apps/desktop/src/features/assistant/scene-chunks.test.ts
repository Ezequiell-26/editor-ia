import { describe, expect, it } from 'vitest';
import { chunkOutputName, fileNameOf, planSceneChunks } from './scene-chunks';

describe('chunks de escena', () => {
  it('divide un rango en partes contiguas y conserva el último tramo', () => {
    expect(planSceneChunks(0, 250, 100)).toEqual([
      { index: 0, startFrame: 0, endFrame: 100 },
      { index: 1, startFrame: 100, endFrame: 200 },
      { index: 2, startFrame: 200, endFrame: 250 },
    ]);
  });

  it('normaliza límites inválidos y no inventa chunks vacíos', () => {
    expect(planSceneChunks(-10, 10, 5)[0]?.startFrame).toBe(0);
    expect(planSceneChunks(20, 20, 10)).toEqual([]);
    expect(planSceneChunks(10, 5, 10)).toEqual([]);
    expect(planSceneChunks(0, 25, 0)).toHaveLength(25);
  });

  it('genera nombres estables junto al segmento final', () => {
    expect(chunkOutputName('Escena-r3.mp4', 0)).toBe('Escena-r3-c01.mp4');
    expect(chunkOutputName('Escena-r3.MP4', 11)).toBe('Escena-r3-c12.MP4');
    expect(chunkOutputName('sin-extension', 1)).toBe('sin-extension-c02');
  });

  it('extrae el nombre de rutas POSIX y Windows', () => {
    const backslash = String.fromCharCode(92);
    expect(fileNameOf('/tmp/proyecto/renders/Escena-r3.mp4')).toBe('Escena-r3.mp4');
    expect(fileNameOf(`C:${backslash}Temp${backslash}renders${backslash}Escena-r3.mp4`)).toBe(
      'Escena-r3.mp4',
    );
    expect(fileNameOf('Escena-r3.mp4')).toBe('Escena-r3.mp4');
    expect(fileNameOf('')).toBe('');
  });
});
