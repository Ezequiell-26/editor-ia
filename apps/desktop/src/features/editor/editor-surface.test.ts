import { describe, expect, it } from 'vitest';
import type { EditorModeId } from '../../app/view-routing';
import { editorSurfaceClass } from './editor-surface';

/** Espejo de `EDITOR_MODES` en EditorWorkspace (17 modos). */
const ALL_MODES: readonly EditorModeId[] = [
  'timeline',
  'brain',
  'text-edit',
  'multicam',
  'mixer',
  'vfx',
  'nodes',
  'motion',
  'visuals',
  'guide',
  'tools',
  'script',
  'assets',
  'production',
  'director',
  'auto-edit',
  'ai-hub',
];

describe('superficie única · chrome AlaukCut', () => {
  it('la raíz es siempre editor-workspace', () => {
    for (const mode of ALL_MODES) {
      expect(editorSurfaceClass(mode).split(' ')[0]).toBe('editor-workspace');
    }
  });

  it('los 17 modos llevan el chrome AlaukCut', () => {
    for (const mode of ALL_MODES) {
      expect(editorSurfaceClass(mode).split(' ')).toContain('alaukcut-chrome');
    }
  });

  it('la geometría de referencia de tres columnas queda sólo en timeline', () => {
    expect(editorSurfaceClass('timeline').split(' ')).toContain('alaukcut');
    for (const mode of ALL_MODES.filter((candidate) => candidate !== 'timeline')) {
      expect(editorSurfaceClass(mode).split(' ')).not.toContain('alaukcut');
    }
  });
});
