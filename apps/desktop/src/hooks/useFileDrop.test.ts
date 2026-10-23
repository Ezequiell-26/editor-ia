import { describe, expect, it } from 'vitest';
import { MEDIA_EXTENSIONS, splitDroppedPaths } from './useFileDrop';

describe('splitDroppedPaths', () => {
  it('acepta las extensiones de medios conocidas', () => {
    const { accepted, ignored } = splitDroppedPaths([
      'C:\\clips\\video.mp4',
      'C:/musica/tema.MP3',
      'D:\\fotos\\paisaje.JPEG',
      '/home/user/anim.webm',
      'sonido.flac',
    ]);
    expect(accepted).toHaveLength(5);
    expect(ignored).toHaveLength(0);
  });

  it('separa lo que no sirve y reporta sólo el nombre', () => {
    const { accepted, ignored } = splitDroppedPaths([
      'C:\\clips\\bueno.mp4',
      'C:\\clips\\documento.pdf',
      'C:\\clips\\sin-extension',
      'C:\\clips\\rar.7z',
    ]);
    expect(accepted).toEqual(['C:\\clips\\bueno.mp4']);
    expect(ignored).toEqual(['documento.pdf', 'sin-extension', 'rar.7z']);
  });

  it('no distingue mayúsculas ni puntos en el nombre', () => {
    const { accepted } = splitDroppedPaths(['Mi.Video.Final.MKV', 'a.b.png']);
    expect(accepted).toHaveLength(2);
  });

  it('la lista de extensiones no tiene duplicados ni está vacía', () => {
    expect(MEDIA_EXTENSIONS.length).toBeGreaterThan(15);
    expect(new Set(MEDIA_EXTENSIONS).size).toBe(MEDIA_EXTENSIONS.length);
  });
});
