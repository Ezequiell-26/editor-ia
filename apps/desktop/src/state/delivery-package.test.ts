import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import { buildDeliveryPackage } from './delivery-package';
import { addMarker } from './markers';
import { addAsset, addCaptionCue, addScene, newId } from './project-actions';

const NOW = '2026-10-21T12:00:00.000Z';
const GENERATED = new Date('2026-10-21T15:30:00.000Z');

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: newId(),
    label: 'Toma, "A"',
    kind: 'video',
    source: { type: 'local', path: 'media/toma-a.mp4' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 12_345 },
    rights: {
      license: { id: 'cc-by-4.0', commercialUse: 'requires-attribution' },
      provenance: {
        origin: 'downloaded',
        acquiredAt: NOW,
        sourceUrl: 'https://example.com/toma',
      },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
    ...overrides,
  } as Asset;
}

function projectWithCue() {
  let project = createEmptyProject('Obra: Ñandú / 1', NOW);
  project = addAsset(project, asset());
  const cue = addCaptionCue(project, {
    text: 'Hola y bienvenidos',
    startFrame: 0,
    durationFrames: 60,
  });
  project = cue.project;
  const marker = addMarker(project, 90, { label: 'Capítulo 1' });
  project = marker.project;
  const scene = addScene(project, {
    title: 'Apertura',
    intent: 'hook',
    narration: 'Primera escena',
  });
  return scene.project;
}

describe('paquete de entrega', async () => {
  it('produce un zip real con proyecto, subtítulos, derechos, manifiesto y readme', async () => {
    const bundle = await buildDeliveryPackage(projectWithCue(), GENERATED);
    expect([bundle.bytes[0], bundle.bytes[1]]).toEqual([0x50, 0x4b]);
    const files = unzipSync(bundle.bytes);
    expect(Object.keys(files).sort()).toEqual(bundle.entries);
    expect(bundle.entries).toEqual([
      'LEEME.txt',
      'derechos.csv',
      'manifiesto.json',
      'proyecto.editoria.json',
      'subtitulos.srt',
    ]);
  });

  it('el proyecto incluido se puede volver a leer y conserva su identidad', async () => {
    const project = projectWithCue();
    const bundle = await buildDeliveryPackage(project, GENERATED);
    const files = unzipSync(bundle.bytes);
    const parsed = JSON.parse(strFromU8(files['proyecto.editoria.json'] as Uint8Array));
    expect(parsed.id).toBe(project.id);
    expect(parsed.timeline.clips).toHaveLength(0);
    expect(parsed.captions.cues).toHaveLength(1);
  });

  it('exporta el SRT con tiempos de la pista principal', async () => {
    const bundle = await buildDeliveryPackage(projectWithCue(), GENERATED);
    const srt = strFromU8(unzipSync(bundle.bytes)['subtitulos.srt'] as Uint8Array);
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('Hola y bienvenidos');
  });

  it('escapa comas y comillas en el CSV de derechos', async () => {
    const bundle = await buildDeliveryPackage(projectWithCue(), GENERATED);
    const csv = strFromU8(unzipSync(bundle.bytes)['derechos.csv'] as Uint8Array);
    expect(csv).toContain('"Toma, ""A"""');
    expect(csv).toContain('"cc-by-4.0"');
    expect(csv).toContain('"requires-attribution"');
    expect(csv).toContain(`"${'b'.repeat(64)}"`);
  });

  it('el manifiesto cuenta los elementos y declara que no copia medios', async () => {
    const bundle = await buildDeliveryPackage(projectWithCue(), GENERATED);
    const files = unzipSync(bundle.bytes);
    const manifest = JSON.parse(strFromU8(files['manifiesto.json'] as Uint8Array));
    expect(manifest.schema).toBe('editor-ia-delivery/1');
    expect(manifest.generatedAt).toBe('2026-10-21T15:30:00.000Z');
    expect(manifest.counts).toMatchObject({
      assets: 1,
      captionCues: 1,
      markers: 1,
      scenes: 1,
    });
    expect(manifest.assets[0]).toMatchObject({
      license: 'cc-by-4.0',
      commercialUse: 'requires-attribution',
      sha256: 'b'.repeat(64),
    });
    const readme = strFromU8(files['LEEME.txt'] as Uint8Array);
    expect(readme).toContain('Los medios no se copian');
  });

  it('no inventa un SRT vacío cuando el proyecto no tiene subtítulos', async () => {
    const bundle = await buildDeliveryPackage(createEmptyProject('Sin subtítulos', NOW), GENERATED);
    expect(bundle.entries).not.toContain('subtitulos.srt');
    const readme = strFromU8(unzipSync(bundle.bytes)['LEEME.txt'] as Uint8Array);
    expect(readme).not.toContain('subtitulos.srt');
  });

  it('genera un nombre de archivo seguro a partir del nombre del proyecto', async () => {
    const bundle = await buildDeliveryPackage(projectWithCue(), GENERATED);
    expect(bundle.fileName).toBe('obra-nandu-1-paquete.zip');
  });
});
