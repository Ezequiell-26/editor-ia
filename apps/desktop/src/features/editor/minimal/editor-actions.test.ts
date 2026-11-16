import { describe, expect, it } from 'vitest';
import {
  ACTION_VIEWS, TOOL_ACTIONS, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN,
  clampZoom, isHarnessHost, resolveAction,
} from './editor-actions';
import { FEATURE_CARDS, TIMELINE_TOOLS_LEFT, TIMELINE_TOOLS_RIGHT } from './model';

/** Etiquetas que MinimalEditor y sus paneles renderizan como botones. */
const VISIBLE_LABELS: readonly string[] = [
  'Arquivo', 'Versão', 'Atualização', 'Configurações', 'Ajuda', 'Projetos',
  'Layout', 'Histórico', 'Edição automática', 'Atalhos',
  'Gravar tela / webcam', 'Gravar Mídias', 'Mão Mágica',
  'Gerar legendas', 'Pedir ao assistente',
  'Aplicar câmera neste trecho',
  'Menos zoom', 'Mais zoom',
  'Capturar quadro', 'Quadro anterior', 'Quadro seguinte',
];

describe('contrato de acciones de la réplica', () => {
  it('ninguna herramienta del timeline queda decorativa', () => {
    for (const tool of [...TIMELINE_TOOLS_LEFT, ...TIMELINE_TOOLS_RIGHT]) {
      expect(resolveAction(tool.label), `herramienta «${tool.label}»`).not.toBeNull();
    }
  });

  it('ningún menú, tarjeta ni botón de panel queda decorativo', () => {
    for (const card of FEATURE_CARDS) {
      expect(resolveAction(card.title), `tarjeta «${card.title}»`).not.toBeNull();
    }
    for (const label of VISIBLE_LABELS) {
      expect(resolveAction(label), `control «${label}»`).not.toBeNull();
    }
  });

  it('toda acción de navegación apunta a una vista declarada', () => {
    const views = Object.values(ACTION_VIEWS);
    expect(views.length).toBeGreaterThan(8);
    for (const view of views) {
      expect(typeof view).toBe('string');
      expect(view?.length).toBeGreaterThan(0);
    }
    for (const action of Object.values(TOOL_ACTIONS)) {
      if (action.startsWith('navigate-') || action === 'capture-frame') {
        expect(ACTION_VIEWS[action], `acción ${action}`).toBeDefined();
      }
    }
    expect(ACTION_VIEWS['generate-captions']).toBe('localization');
  });

  it('clampZoom mantiene la escala dentro del rango seguro', () => {
    expect(clampZoom(ZOOM_DEFAULT)).toBe(1);
    expect(clampZoom(-10)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MAX);
  });

  it('el arnés de escenas queda fuera de la app empaquetada', () => {
    expect(isHarnessHost('localhost')).toBe(true);
    expect(isHarnessHost('127.0.0.1')).toBe(true);
    expect(isHarnessHost('tauri.localhost')).toBe(false);
    expect(isHarnessHost('')).toBe(false);
  });
});
