import { describe, expect, it } from 'vitest';
import { parseOperatorCommand } from './operator';

const views = [
  { id: 'home' as const, label: 'Inicio' },
  { id: 'editor' as const, label: 'Editor' },
  { id: 'ai-hub' as const, label: 'AI Hub' },
];

describe('operador local', () => {
  it('navega por nombre y por id', () => {
    expect(parseOperatorCommand('abrir editor', views)).toMatchObject({
      kind: 'navigate',
      view: 'editor',
    });
    expect(parseOperatorCommand('ir a AI Hub', views)).toMatchObject({
      kind: 'navigate',
      view: 'ai-hub',
    });
  });

  it('reconoce controles de reproducción y proyecto', () => {
    expect(parseOperatorCommand('reproducir', views).kind).toBe('play');
    expect(parseOperatorCommand('pausar', views).kind).toBe('pause');
    expect(parseOperatorCommand('guardar', views).kind).toBe('save');
    expect(parseOperatorCommand('exportar', views).kind).toBe('export');
    expect(parseOperatorCommand('deshacer', views).kind).toBe('undo');
    expect(parseOperatorCommand('estado', views).kind).toBe('status');
    expect(parseOperatorCommand('crear un short sobre recetas', views)).toMatchObject({
      kind: 'create',
      topic: 'recetas',
    });
  });

  it('no inventa una vista desconocida', () => {
    const action = parseOperatorCommand('abrir ovnis', views);
    expect(action.kind).toBe('unknown');
  });

  it('crea títulos, lower thirds, cierres y datos sin IA', () => {
    expect(parseOperatorCommand('crear titulo Hola mundo', views)).toMatchObject({
      kind: 'motion',
      templateId: 'title-card',
      text: 'Hola mundo',
    });
    expect(parseOperatorCommand('crear título Apertura épica', views)).toMatchObject({
      kind: 'motion',
      templateId: 'title-card',
      text: 'Apertura épica',
    });
    expect(parseOperatorCommand('crear lower third Ana Pérez, Editora', views)).toMatchObject({
      kind: 'motion',
      templateId: 'lower-third',
      text: 'Ana Pérez',
      secondary: 'Editora',
    });
    expect(parseOperatorCommand('crear cierre Gracias por ver', views)).toMatchObject({
      kind: 'motion',
      templateId: 'end-card',
      text: 'Gracias por ver',
    });
    expect(parseOperatorCommand('crear dato +120%, más retención', views)).toMatchObject({
      kind: 'motion',
      templateId: 'stat-callout',
      text: '+120%',
      secondary: 'más retención',
    });
  });
});
