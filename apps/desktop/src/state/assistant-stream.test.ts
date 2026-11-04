import { describe, expect, it } from 'vitest';
import { replyPreviewFromStream } from './assistant-stream';

describe('vista previa del reply durante el streaming', () => {
  it('extrae el texto aunque el JSON esté incompleto', () => {
    expect(replyPreviewFromStream('{"rep')).toBe('');
    expect(replyPreviewFromStream('{"reply":"Ho')).toBe('Ho');
    expect(replyPreviewFromStream('{"reply":"Hola mun')).toBe('Hola mun');
    expect(replyPreviewFromStream('{"reply":"Hola mundo"')).toBe('Hola mundo');
    expect(replyPreviewFromStream('{"reply":"Hola mundo","actions":[]}')).toBe('Hola mundo');
  });

  it('decodifica escapes ya completos y espera un escape cortado', () => {
    expect(replyPreviewFromStream('{"reply":"linea 1\\nlinea 2')).toBe('linea 1\nlinea 2');
    expect(replyPreviewFromStream('{"reply":"comillas \\"ok\\"')).toBe('comillas "ok"');
    expect(replyPreviewFromStream('{"reply":"corte \\')).toBe('corte ');
    expect(replyPreviewFromStream('{"reply":"corte \\n')).toBe('corte \n');
  });

  it('no confunde el campo reply con texto suelto y respeta comillas de cierre', () => {
    expect(replyPreviewFromStream('sin json')).toBe('');
    expect(replyPreviewFromStream('{"action":{"kind":"status"},"reply":"Listo"}')).toBe('Listo');
    expect(replyPreviewFromStream('{"reply": 42}')).toBe('');
  });
});
