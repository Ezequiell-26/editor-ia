import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ensureDelivery } from './project-actions';
import { chooseExportProfile, projectRatio } from './render-profile';

function projectWith(width: number, height: number) {
  const project = ensureDelivery(createEmptyProject('Perfil'));
  project.video = { width, height, frameRate: { num: 30, den: 1 } };
  return project;
}

describe('chooseExportProfile', () => {
  it('elige el perfil que coincide con el formato del proyecto', () => {
    expect(chooseExportProfile(projectWith(1920, 1080))?.aspectRatio).toBe('16:9');
    expect(chooseExportProfile(projectWith(1080, 1920))?.aspectRatio).toBe('9:16');
    expect(chooseExportProfile(projectWith(1080, 1080))?.aspectRatio).toBe('1:1');
  });

  it('cae al primer perfil si ninguno coincide', () => {
    const project = ensureDelivery(createEmptyProject('Raro'));
    project.video = { width: 2560, height: 1080, frameRate: { num: 30, den: 1 } };
    expect(chooseExportProfile(project)).toBe(project.renderProfiles[0]);
  });

  it('sin perfiles devuelve null', () => {
    const project = createEmptyProject('Vacío');
    expect(chooseExportProfile(project)).toBeNull();
  });

  it('reconoce la relación del proyecto', () => {
    expect(projectRatio(projectWith(1920, 1080))).toBe('16:9');
    expect(projectRatio(projectWith(1080, 1920))).toBe('9:16');
    expect(projectRatio(projectWith(720, 720))).toBe('1:1');
  });
});
