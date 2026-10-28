import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { readyAsset } from '../test/fake-service';
import { addAsset, addClipFromAsset } from './project-actions';

const NOW = '2026-10-27T00:00:00.000Z';

describe('asset descargado listo para montar', () => {
  it('entra al proyecto y crea un clip válido', () => {
    const base = createEmptyProject('Descarga', NOW);
    const asset = readyAsset({
      label: 'Video descargado',
      source: { type: 'local', path: 'media/video-descargado.mp4' },
    });
    const withAsset = addAsset(base, asset);
    const placed = addClipFromAsset(withAsset, asset, { atFrame: 0 });
    expect(placed.project.timeline.clips).toHaveLength(1);
    const parsed = parseProject(placed.project);
    if (!parsed.ok) {
      // Ayuda a diagnosticar el motivo exacto sin imprimir todo el proyecto.
      throw new Error(parsed.issues.map((issue) => `${String(issue.path)}: ${issue.message}`).join(' | '));
    }
    expect(parsed.ok).toBe(true);
  });
});
