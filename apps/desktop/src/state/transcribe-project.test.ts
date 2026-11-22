import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { TranscriptionResult } from '../services/contracts';
import {
  addAsset,
  addClipFromAsset,
  newId,
} from './project-actions';
import {
  transcribeProjectClips,
  type TranscribeProjectStore,
} from './transcribe-project';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(createEmptyProject('Lote', NOW));
}

function audioAsset(id: string, durationFrames = 300): Asset {
  return {
    id,
    label: `Voz ${id}`,
    kind: 'audio',
    source: { type: 'local', path: `media/${id}.wav` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

function transcription(segments: TranscriptionResult['segments']): TranscriptionResult {
  return {
    language: 'es',
    languageProbability: 0.99,
    durationSeconds: 10,
    model: 'small',
    segments,
  };
}

interface FakeStore extends TranscribeProjectStore {
  project(): ProjectDocument | null;
  /** Simula el cambio de proyecto abierto a mitad de una operación async. */
  replace(next: ProjectDocument | null): void;
}

function makeStore(
  project: ProjectDocument,
  service: TranscribeProjectStore['service'],
): FakeStore {
  let current: ProjectDocument | null = project;
  // `state` queda congelado como en el store real (foto del render que
  // invocó la función); el proyecto vivo se lee por `getProject()`.
  const snapshot = { project };
  return {
    get state() {
      return snapshot;
    },
    getProject: () => current,
    service,
    project: () => current,
    replace(next) {
      current = next;
    },
    async saveNow() {
      return true;
    },
    update(recipe) {
      if (!current) return false;
      current = validated(recipe(current));
      return true;
    },
    setNotice() {},
  };
}

describe('transcribeProjectClips', () => {
  it('transcribe cada asset una sola vez y subtitula todos los clips elegibles', async () => {
    const project = base();
    const shared = audioAsset(newId(), 300);
    const other = audioAsset(newId(), 300);
    let withAssets = addAsset(project, shared);
    withAssets = addAsset(withAssets, other);
    // Dos clips sobre el mismo asset en ventanas distintas + uno de otro asset.
    const c1 = addClipFromAsset(withAssets, shared, {
      atFrame: 0,
      inFrame: 0,
      outFrame: 90,
    });
    const c2 = addClipFromAsset(c1.project, shared, {
      atFrame: 200,
      inFrame: 90,
      outFrame: 180,
    });
    const c3 = addClipFromAsset(c2.project, other, {
      atFrame: 400,
      inFrame: 0,
      outFrame: 90,
    });
    const initial = validated(c3.project);

    const calls: string[] = [];
    const store = makeStore(initial, {
      async transcribeAsset(assetId) {
        calls.push(assetId);
        return transcription([
          { start: 0, end: 1, text: 'uno', words: [] },
          { start: 3, end: 4, text: 'dos', words: [] }, // cae en la ventana del segundo clip
          { start: 6, end: 7, text: 'tres', words: [] },
        ]);
      },
    });

    const summary = await transcribeProjectClips(store);
    expect(calls.sort()).toEqual([shared.id, other.id].sort());
    expect(summary.assetsTranscribed).toBe(2);
    expect(summary.failed).toEqual([]);

    const final = store.project();
    expect(final).not.toBeNull();
    const texts = final!.captions.cues.map((cue) => cue.text);
    // Clip 1 (0..3 s del asset): 'uno'. Clip 2 (3..6 s): 'dos'. Clip 3 (asset
    // distinto, ventana 0..3 s): 'uno'.
    expect(texts.filter((text) => text === 'uno')).toHaveLength(2);
    expect(texts).toContain('dos');
    expect(summary.cuesAdded).toBe(3);
    expect(summary.clips).toBe(3);
  });

  it('sigue con el resto cuando un asset falla y reporta el fallo por clip', async () => {
    const project = base();
    const bad = audioAsset(newId(), 300);
    const good = audioAsset(newId(), 300);
    let withAssets = addAsset(project, bad);
    withAssets = addAsset(withAssets, good);
    const c1 = addClipFromAsset(withAssets, bad, { atFrame: 0, inFrame: 0, outFrame: 90 });
    const c2 = addClipFromAsset(c1.project, good, { atFrame: 200, inFrame: 0, outFrame: 90 });
    const initial = validated(c2.project);

    const store = makeStore(initial, {
      async transcribeAsset(assetId) {
        if (assetId === bad.id) throw new Error('modelo no disponible');
        return transcription([{ start: 0, end: 1, text: 'ok', words: [] }]);
      },
    });

    const summary = await transcribeProjectClips(store);
    expect(summary.cuesAdded).toBe(1);
    expect(summary.clips).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.reason).toContain('modelo no disponible');
    const final = store.project();
    expect(final!.captions.cues.some((cue) => cue.text === 'ok')).toBe(true);
  });

  it('reporta progreso por clip y no inserta nada sin clips elegibles', async () => {
    const project = base();
    const store = makeStore(project, {
      async transcribeAsset() {
        return transcription([]);
      },
    });
    const progress: string[] = [];
    const summary = await transcribeProjectClips(store, {
      onProgress: (done, total, label) => progress.push(`${done}/${total}:${label}`),
    });
    expect(summary).toMatchObject({ clips: 0, cuesAdded: 0, skipped: [], failed: [] });
    expect(progress).toEqual([]);
  });

  it('aborta el lote si el proyecto cambia durante la transcripción', async () => {
    const project = base();
    const audioA = audioAsset(newId(), 300);
    const audioB = audioAsset(newId(), 300);
    let withAssets = addAsset(project, audioA);
    withAssets = addAsset(withAssets, audioB);
    const c1 = addClipFromAsset(withAssets, audioA, { atFrame: 0, inFrame: 0, outFrame: 90 });
    const c2 = addClipFromAsset(c1.project, audioB, { atFrame: 200, inFrame: 0, outFrame: 90 });
    const c3 = addClipFromAsset(c2.project, audioA, { atFrame: 400, inFrame: 0, outFrame: 90 });
    const initial = validated(c3.project);
    const otherProject = validated(base());

    const store = makeStore(initial, {
      async transcribeAsset(assetId) {
        // El usuario cambia de proyecto mientras el primer asset se
        // transcribe: los clips siguientes no deben aplicarse al nuevo.
        if (assetId === audioA.id) store.replace(otherProject);
        return transcription([{ start: 0, end: 1, text: 'hola', words: [] }]);
      },
    });

    const summary = await transcribeProjectClips(store);
    expect(summary.cuesAdded).toBe(0);
    expect(summary.failed.length).toBeGreaterThan(0);
    expect(summary.failed.every((item) => item.reason.includes('cambió'))).toBe(true);
    // El proyecto nuevo quedó intacto: sin cues colados del proyecto viejo.
    expect(store.project()!.captions.cues).toHaveLength(0);
  });

  it('marca skipped los clips cuya ventana no tiene voz', async () => {
    const project = base();
    const audio = audioAsset(newId(), 300);
    const withAsset = addAsset(project, audio);
    // Ventana 6..9 s del asset; la transcripción sólo habla en 0..2 s.
    const added = addClipFromAsset(withAsset, audio, {
      atFrame: 0,
      inFrame: 180,
      outFrame: 270,
    });
    const initial = validated(added.project);
    const store = makeStore(initial, {
      async transcribeAsset() {
        return transcription([{ start: 0, end: 2, text: 'al principio', words: [] }]);
      },
    });
    const summary = await transcribeProjectClips(store);
    expect(summary.cuesAdded).toBe(0);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0]?.reason).toContain('sin voz');
    expect(store.project()!.captions.cues).toHaveLength(0);
  });
});
