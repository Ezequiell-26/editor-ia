import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addScene, ensureDelivery, updateScene } from '../../state/project-actions';
import {
  DEFAULT_FLOW_STYLE,
  buildFlowPrompts,
  flowPromptsToText,
} from './flow-prompts';

const NOW = '2026-10-19T00:00:00.000Z';

function base(): ProjectDocument {
  return ensureDelivery(createEmptyProject('Storyboard', NOW));
}

function withTwoScenes(): ProjectDocument {
  let project = base();
  const first = addScene(project, {
    title: 'El faro',
    intent: 'hook',
    narration: 'Un faro azul resiste la tormenta.',
  });
  project = updateScene(first.project, first.sceneId, {
    notes: 'Un faro azul sobre un acantilado, olas altas, cielo de tormenta.',
  });
  const second = addScene(project, {
    title: 'La calma',
    intent: 'outro',
    narration: 'Al amanecer, el mar vuelve a estar quieto.',
  });
  project = updateScene(second.project, second.sceneId, {
    notes: 'El mismo faro al amanecer, mar en calma, luz dorada.',
  });
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error('proyecto inválido');
  return parsed.project;
}

describe('prompts para Flow', () => {
  it('produce un prompt por escena, en orden y con el estilo elegido', () => {
    const prompts = buildFlowPrompts(withTwoScenes(), {
      style: 'Estilo de prueba',
      includeNarration: false,
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.title).toBe('El faro');
    expect(prompts[0]?.prompt).toContain('Estilo de prueba');
    expect(prompts[0]?.prompt).toContain('Un faro azul sobre un acantilado');
    expect(prompts[0]?.prompt).not.toContain('resiste la tormenta');
    expect(prompts[1]?.prompt).toContain('El mismo faro al amanecer');
  });

  it('incluye la narración como contexto cuando se pide', () => {
    const prompts = buildFlowPrompts(withTwoScenes(), {
      style: '',
      includeNarration: true,
    });

    expect(prompts[0]?.prompt).toContain('resiste la tormenta');
    expect(prompts[0]?.prompt).toContain('Un faro azul sobre un acantilado');
  });

  it('usa la narración como sujeto cuando la escena no tiene nota visual', () => {
    let project = base();
    const added = addScene(project, {
      title: 'Sin nota',
      intent: 'explainer',
      narration: 'Una ciudad flotante sobre el mar.',
    });
    project = added.project;

    const prompts = buildFlowPrompts(project, { style: '', includeNarration: false });

    expect(prompts[0]?.prompt).toContain('Una ciudad flotante sobre el mar.');
  });

  it('no inventa prompts si el proyecto no tiene escenas', () => {
    expect(buildFlowPrompts(base(), { style: DEFAULT_FLOW_STYLE, includeNarration: true })).toEqual([]);
  });

  it('exporta exactamente una línea por prompt y recorta el largo máximo', () => {
    const long = 'x'.repeat(8_000);
    let project = base();
    const added = addScene(project, {
      title: 'Largo',
      intent: 'explainer',
      narration: 'Narración.',
    });
    project = updateScene(added.project, added.sceneId, { notes: long });

    const prompts = buildFlowPrompts(project, { style: 'Estilo', includeNarration: false });
    const text = flowPromptsToText(prompts);

    expect(prompts[0]?.prompt.length).toBeLessThanOrEqual(4_000);
    expect(text.split('\n')).toHaveLength(1);
    expect(text).not.toContain('\n\n');
  });
});
