import { describe, expect, it } from 'vitest';
import { routeLabel, titleLooksLikeMusic } from './DownloadView';

describe('enrutamiento automático del descargador', () => {
  it('detecta títulos musicales con la misma lista que Rust', () => {
    expect(titleLooksLikeMusic('Official music video')).toBe(true);
    expect(titleLooksLikeMusic('Letra de la canción')).toBe(true);
    expect(titleLooksLikeMusic('Tutorial de edición')).toBe(false);
    expect(titleLooksLikeMusic(null)).toBe(false);
  });

  it('describe la ruta corta con look completo y audio original masterizado', () => {
    const label = routeLabel(45, 'Clip de producto');
    expect(label).toMatch(/corto/i);
    expect(label).toMatch(/audio original masterizado/i);
    expect(label).toMatch(/flujo óptico/i);
    expect(label).not.toMatch(/Piper/i);
  });

  it('describe la ruta larga sin flujo óptico y con audio tratado', () => {
    const label = routeLabel(61, 'Documental completo');
    expect(label).toMatch(/largo/i);
    expect(label).toMatch(/sin flujo óptico/i);
    expect(label).toMatch(/1,02×/);
  });

  it('la música conserva el audio original aunque sea larga', () => {
    expect(routeLabel(30, 'My song cover')).toMatch(/audio original intacto/i);
    const long = routeLabel(180, 'Concierto · music');
    expect(long).toMatch(/espejo y zoom/i);
    expect(long).toMatch(/audio original.*intacto/i);
  });

  it('sin duración avisa que el enrutador decide al descargar', () => {
    expect(routeLabel(null, 'Video')).toMatch(/duración desconocida/i);
  });
});
