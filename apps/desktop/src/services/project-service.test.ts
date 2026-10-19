import { describe, expect, it } from 'vitest';
import {
  baseName,
  isLocalProviderUrl,
  joinProjectPath,
  providerUrlProblem,
  safeDisplayLabel,
  sanitizeForUi,
} from './project-service';

describe('helpers del borde nativo', () => {
  it('deja solo el nombre del archivo en las etiquetas y errores', () => {
    expect(safeDisplayLabel('C:\\Users\\persona\\proyectos\\corte.editoria.json')).toBe(
      'corte.editoria.json',
    );
    expect(baseName('/home/persona/obra.json')).toBe('obra.json');
    expect(sanitizeForUi('falló C:\\Users\\persona\\obra\\media\\a.mp4')).not.toContain(
      'persona',
    );
  });

  it('une rutas relativas con el separador del proyecto', () => {
    expect(joinProjectPath('C:\\trabajo\\obra', 'media/toma.mp4')).toBe(
      'C:\\trabajo\\obra\\media\\toma.mp4',
    );
    expect(joinProjectPath('/home/obra/', 'media/toma.mp4')).toBe('/home/obra/media/toma.mp4');
  });

  it('reconoce loopback exacto y rechaza hosts con prefijo parecido', () => {
    expect(isLocalProviderUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalProviderUrl('https://localhost:8443/v1')).toBe(true);
    expect(isLocalProviderUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalProviderUrl('http://127.0.0.1.evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('http://localhost.evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('http://localhost@evil.example/v1')).toBe(false);
    expect(isLocalProviderUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('exige https para proveedores remotos y prohíbe userinfo', () => {
    expect(providerUrlProblem('https://api.openai.com/v1')).toBeNull();
    expect(providerUrlProblem('http://127.0.0.1:11434/v1')).toBeNull();
    expect(providerUrlProblem('http://api.openai.com/v1')).toMatch(/https/);
    expect(providerUrlProblem('https://user:pass@api.openai.com/v1')).toMatch(/usuario/);
    expect(providerUrlProblem('ftp://localhost/v1')).toMatch(/http/);
    expect(providerUrlProblem('no es una url')).toMatch(/válida/);
  });
});
