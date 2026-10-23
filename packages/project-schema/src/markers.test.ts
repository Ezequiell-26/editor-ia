import { describe, expect, it } from 'vitest';
import { createEmptyProject, ProjectDocumentSchema } from './project.ts';
import { MarkerSchema } from './markers.ts';

const ID = '4f2b6a1e-8c9d-4e5f-a0b1-c2d3e4f5a6b7';

function marker(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    frame: 30,
    label: 'Intro',
    color: 'mint',
    ...overrides,
  };
}

describe('MarkerSchema', () => {
  it('accepts a labelled marker with a colour', () => {
    expect(MarkerSchema.safeParse(marker()).success).toBe(true);
  });

  it('rejects a label that spans more than one line', () => {
    expect(MarkerSchema.safeParse(marker({ label: 'Intro\nSegunda' })).success).toBe(false);
  });

  it('rejects an unknown colour', () => {
    expect(MarkerSchema.safeParse(marker({ color: 'neon' })).success).toBe(false);
  });

  it('accepts a marker range and rejects an end before the start', () => {
    expect(MarkerSchema.safeParse(marker({ endFrame: 90 })).success).toBe(true);
    expect(MarkerSchema.safeParse(marker({ endFrame: 30 })).success).toBe(false);
    expect(MarkerSchema.safeParse(marker({ endFrame: 10 })).success).toBe(false);
  });

  it('rejects a negative frame', () => {
    expect(MarkerSchema.safeParse(marker({ frame: -1 })).success).toBe(false);
  });
});

describe('project markers', () => {
  it('starts empty and loads projects written before markers existed', () => {
    const project = createEmptyProject('Marcadores');
    expect(project.markers).toEqual([]);
    const legacy = { ...project } as Record<string, unknown>;
    delete legacy.markers;
    const parsed = ProjectDocumentSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.markers).toEqual([]);
  });

  it('rejects two markers on the same frame', () => {
    const project = createEmptyProject('Marcadores');
    const result = ProjectDocumentSchema.safeParse({
      ...project,
      markers: [marker(), marker({ id: '5f2b6a1e-8c9d-4e5f-a0b1-c2d3e4f5a6b7' })],
    });
    expect(result.success).toBe(false);
  });

  it('caps the root collection so a hand-edited file stays bounded', () => {
    const project = createEmptyProject('Marcadores');
    const markers = Array.from({ length: 201 }, (_, index) => {
      const suffix = String(index).padStart(12, '0');
      return marker({ id: `4f2b6a1e-8c9d-4e5f-a0b1-${suffix}`, frame: index });
    });
    expect(ProjectDocumentSchema.safeParse({ ...project, markers }).success).toBe(false);
  });
});
