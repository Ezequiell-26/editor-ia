import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  CaptionAnimationSchema,
  CaptionStyleSchema,
  createEmptyProject,
  parseProject,
} from '@editor-ia/project-schema';
import { addTitleFromTemplate, ensureDelivery } from './project-actions';
import { TITLE_TEMPLATES } from './title-templates';

/**
 * Pruebas de los seis presets pro de títulos: claves únicas, estructura
 * válida contra el esquema real de estilos y textos/posiciones que cada
 * preset produce al materializarse en un proyecto.
 */

const NOW = '2025-01-01T00:00:00.000Z';

const IDS_PRO = [
  'reticula-noticias',
  'kicker-lateral',
  'cita-documental',
  'marca-agua',
  'capitulo',
  'entrevista',
] as const;

function presetPro(id: (typeof IDS_PRO)[number]) {
  const template = TITLE_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`falta el preset pro ${id}`);
  return template;
}

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
}

describe('plantillas de título pro', () => {
  it('las claves son únicas en toda la biblioteca', () => {
    const ids = TITLE_TEMPLATES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of IDS_PRO) {
      expect(ids.filter((item) => item === id)).toHaveLength(1);
    }
  });

  it('los seis presets pro existen con nombre y descripción en español', () => {
    for (const id of IDS_PRO) {
      const template = presetPro(id);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.sample.length).toBeGreaterThan(0);
    }
    expect(TITLE_TEMPLATES.map((item) => item.id)).toEqual([
      'impacto',
      '3d',
      'caja',
      'minimal',
      'noticias',
      'cita',
      'ticker',
      'lower-third',
      'text-plus',
      'scroll',
      ...IDS_PRO,
    ]);
  });

  it('cada estilo pasa el esquema estricto sin campos inventados', () => {
    for (const template of TITLE_TEMPLATES) {
      const parsed = CaptionStyleSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Estilo de prueba',
        ...template.style,
      });
      if (!parsed.success) {
        throw new Error(
          `estilo inválido en ${template.id}: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      expect(parsed.success).toBe(true);
    }
  });

  it('cada animación de entrada es una admitida por CaptionCue', () => {
    for (const template of TITLE_TEMPLATES) {
      expect(CaptionAnimationSchema.safeParse(template.animation).success).toBe(
        true,
      );
    }
    for (const id of IDS_PRO) {
      expect(['fade', 'slide-up', 'pop']).toContain(presetPro(id).animation);
    }
  });

  it('Retícula noticias produce la barra inferior con titular y subtítulo', () => {
    const template = presetPro('reticula-noticias');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('bottom');
    expect(style?.borderStyle).toBe('box');
    expect(style?.backgroundColor).toBe('#0f1e3d');
    expect(style?.bold).toBe(true);
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    expect(cue?.text).toBe('TITULAR PRINCIPAL\nSubtítulo de la noticia');
    expect(cue?.text.split('\n')).toHaveLength(2);
    expect(cue?.animation).toBe('slide-up');
  });

  it('Kicker lateral coloca la etiqueta de acento arriba', () => {
    const template = presetPro('kicker-lateral');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('top');
    expect(style?.borderStyle).toBe('box');
    expect(style?.backgroundColor).toBe('#0369a1');
    expect((style?.fontSizePx ?? 0)).toBeLessThanOrEqual(40);
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    expect(cue?.text).toBe('EN VIVO\nTítulo principal');
    expect(cue?.animation).toBe('slide-up');
  });

  it('Cita documental centra la serif itálica con su atribución', () => {
    const template = presetPro('cita-documental');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('center');
    expect(style?.fontFamily).toBe('Georgia');
    expect(style?.italic).toBe(true);
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    const lines = cue?.text.split('\n') ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith('—')).toBe(true);
    expect(cue?.animation).toBe('fade');
  });

  it('Marca de agua es pequeña, apagada y sin sombra', () => {
    const template = presetPro('marca-agua');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('bottom');
    expect((style?.fontSizePx ?? 400)).toBeLessThanOrEqual(30);
    expect(style?.shadow).toBe(false);
    expect(style?.backgroundColor).toBeUndefined();
    expect(style?.color).toBe('#9aa3ad');
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    expect(cue?.text).toBe('@tucanal');
    expect(cue?.animation).toBe('fade');
  });

  it('Capítulo es numerado, grande y entra por opacidad', () => {
    const template = presetPro('capitulo');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('center');
    expect((style?.fontSizePx ?? 0)).toBeGreaterThanOrEqual(90);
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    expect(cue?.text).toMatch(/^CAPÍTULO \d{2}\n/);
    expect(cue?.text.split('\n')).toHaveLength(2);
    expect(cue?.animation).toBe('fade');
  });

  it('Entrevista produce nombre y cargo en el tercio inferior', () => {
    const template = presetPro('entrevista');
    const result = addTitleFromTemplate(base(), {
      text: template.sample,
      startFrame: 0,
      durationFrames: 60,
      template,
    });
    validated(result.project);
    const style = result.project.captions.styles.find(
      (item) => item.name === `Plantilla · ${template.name}`,
    );
    expect(style?.position).toBe('bottom');
    expect(style?.borderStyle).toBe('box');
    expect(style?.backgroundColor).toBe('#f5f5f4');
    expect(style?.color).toBe('#111111');
    const cue = result.project.captions.cues.find((item) => item.id === result.cueId);
    const lines = cue?.text.split('\n') ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Nombre Apellido');
    expect(lines[1]).toBe('Cargo · Medio');
    expect(cue?.animation).toBe('slide-up');
  });

  it('los seis presets conviven en un mismo proyecto sin choque de estilos', () => {
    let project = base();
    let nextStart = 0;
    for (const id of IDS_PRO) {
      const template = presetPro(id);
      const result = addTitleFromTemplate(project, {
        text: template.sample,
        startFrame: nextStart,
        durationFrames: 60,
        template,
      });
      project = result.project;
      nextStart += 60;
    }
    validated(project);
    for (const id of IDS_PRO) {
      const template = presetPro(id);
      expect(
        project.captions.styles.filter(
          (item) => item.name === `Plantilla · ${template.name}`,
        ),
      ).toHaveLength(1);
    }
  });
});
