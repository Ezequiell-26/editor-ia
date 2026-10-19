import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION, ProjectDocumentSchema, createEmptyProject, parseProject, totalProjectDuration } from './project.ts';

const FIXTURES = new URL('../fixtures/', import.meta.url);

function readFixture(name: string) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8'));
}

const ASSET_VIDEO = '41414141-4141-4414-8414-414141414141';
const ASSET_VOICE = '42424242-4242-4424-8424-424242424242';
const TRACK_VIDEO = '43434343-4343-4434-8434-434343434343';
const TRACK_NARRATION = '44444444-4444-4444-8444-444444444444';
const TRACK_CAPTIONS = '45454545-4545-4454-8454-454545454545';
const CLIP_A = '46464646-4646-4464-8464-464646464646';
const CLIP_B = '47474747-4747-4474-8474-474747474747';
const SCENE_A = '48484848-4848-4484-8484-484848484848';
const MOTION_A = '49494949-4949-4494-8494-494949494949';
const STYLE_A = '4a4a4a4a-4a4a-44aa-8aaa-aaaaaaaaaaaa';
const CUE_A = '4b4b4b4b-4b4b-44bb-8bbb-bbbbbbbbbbbb';
const PROFILE_A = '4c4c4c4c-4c4c-44cc-8ccc-cccccccccccc';
const VARIANT_A = '4d4d4d4d-4d4d-44dd-8ddd-dddddddddddd';
const SOURCE_A = '4e4e4e4e-4e4e-44ee-8eee-eeeeeeeeeeee';
const CLAIM_A = '4f4f4f4f-4f4f-44ff-8fff-ffffffffffff';
const OPERATION_A = '50505050-5050-4500-8500-505050505050';

function asset(id: string, kind: 'video' | 'audio', path: string) {
  return {
    id,
    kind,
    label: kind === 'video' ? 'Demo grabado' : 'Narracion',
    source: { type: 'local', path },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 2_000_000 },
    media:
      kind === 'video'
        ? { width: 1920, height: 1080, durationFrames: 900, frameRate: { num: 30, den: 1 } }
        : { sampleRate: 48000, channels: 1, durationFrames: 600 },
    rights: {
      license: { id: 'owned-by-user', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: '2026-10-18T10:00:00Z' },
    },
  };
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: '60606060-6060-4606-8606-606060606060',
    name: 'Vertical slice de prueba',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T11:00:00Z',
    revision: 4,
    language: 'es',
    video: {
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      backgroundColor: '#101014',
    },
    assets: [asset(ASSET_VIDEO, 'video', 'media/demo.mp4'), asset(ASSET_VOICE, 'audio', 'media/narracion.wav')],
    timeline: {
      tracks: [
        { id: TRACK_VIDEO, kind: 'video', label: 'V1', order: 0 },
        { id: TRACK_NARRATION, kind: 'narration', label: 'N1', order: 1 },
        { id: TRACK_CAPTIONS, kind: 'caption', label: 'C1', order: 2 },
      ],
      clips: [
        {
          id: CLIP_A,
          trackId: TRACK_VIDEO,
          kind: 'video',
          startFrame: 0,
          durationFrames: 300,
          source: { type: 'asset', assetId: ASSET_VIDEO, inFrame: 0, outFrame: 300 },
        },
        {
          id: CLIP_B,
          trackId: TRACK_NARRATION,
          kind: 'audio',
          startFrame: 120,
          durationFrames: 330,
          source: { type: 'asset', assetId: ASSET_VOICE, inFrame: 0, outFrame: 330 },
        },
      ],
    },
    captions: {
      styles: [
        {
          id: STYLE_A,
          name: 'Principal',
          fontFamily: 'Inter',
          fontSizePx: 54,
          color: '#ffffff',
          position: 'bottom',
        },
      ],
      cues: [
        {
          id: CUE_A,
          trackId: TRACK_CAPTIONS,
          styleId: STYLE_A,
          text: 'Probá esto primero',
          language: 'es',
          startFrame: 120,
          endFrame: 165,
        },
      ],
    },
    scenes: [
      {
        id: SCENE_A,
        order: 0,
        title: 'Apertura',
        intent: 'hook',
        status: 'reviewed',
        narration: { text: 'Probá esto primero', estimatedDurationFrames: 120 },
        clipIds: [CLIP_A, CLIP_B],
      },
    ],
    motion: [
      {
        id: MOTION_A,
        template: { id: 'lower-third', version: '1.2.0', source: 'bundled' },
        props: { label: 'Editor IA' },
      },
    ],
    audio: { master: { gainDb: 0, limiter: true } },
    renderProfiles: [
      {
        id: PROFILE_A,
        name: 'YouTube 1080p',
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        resolution: { width: 1920, height: 1080 },
        frameRate: { num: 30, den: 1 },
        bitrate: { mode: 'crf', crf: 20 },
        pixelFormat: 'yuv420p',
        audioSampleRate: 48000,
        audioChannels: 2,
        aspectRatio: '16:9',
        qualityGate: { minOutputBytes: 1_000_000, durationToleranceFrames: 3, requireAllAssetsReady: true },
      },
    ],
    exportVariants: [
      { id: VARIANT_A, name: 'YouTube', renderProfileId: PROFILE_A, platform: 'youtube' },
    ],
    provenance: {
      sources: [
        {
          id: SOURCE_A,
          kind: 'product-docs',
          title: 'Documentación del códec',
          accessedAt: '2026-10-18T09:00:00Z',
          reliability: 'primary',
        },
      ],
      claims: [
        { id: CLAIM_A, text: 'h264 yuv420p se reproduce en todos los destinos', status: 'verified', sourceIds: [SOURCE_A], sceneId: SCENE_A },
      ],
      operations: [
        {
          id: OPERATION_A,
          role: 'editor',
          summary: 'Alinea la narración con la toma 1',
          createdAt: '2026-10-18T10:30:00Z',
          cost: { items: [], disclosed: true, approved: false },
          patch: [{ op: 'replace', path: '/timeline/clips/1/startFrame', value: 120 }],
          expectedRevision: 3,
          appliedStatus: 'applied',
        },
      ],
    },
    migrationHistory: [],
    ...overrides,
  };
}

describe('ProjectDocumentSchema', () => {
  it('accepts a complete vertical slice project', () => {
    const result = ProjectDocumentSchema.safeParse(project());
    if (!result.success) {
      console.log(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('rejects a project that is not version 1', () => {
    expect(ProjectDocumentSchema.safeParse(project({ schemaVersion: 2 })).success).toBe(false);
  });

  it('explains an unsupported schema version instead of a generic shape error', () => {
    const result = parseProject(project({ schemaVersion: 99 }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects a clip that points at an asset the project does not have', () => {
    const broken = project();
    (broken.timeline as { clips: unknown[] }).clips[0] = {
      id: CLIP_A,
      trackId: TRACK_VIDEO,
      kind: 'video',
      startFrame: 0,
      durationFrames: 300,
      source: { type: 'asset', assetId: SOURCE_A, inFrame: 0, outFrame: 300 },
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a clip that points at a motion item that does not exist', () => {
    const broken = project();
    (broken.timeline as { clips: unknown[] }).clips.push({
      id: '71717171-7171-4717-8717-717171717171',
      trackId: '72727272-7272-4727-8727-727272727272',
      kind: 'graphic',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'graphic', motionId: '73737373-7373-4737-8737-737373737373' },
    });
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a caption cue that lives on a non caption track', () => {
    const broken = project();
    (broken.captions as { cues: unknown[] }).cues = [
      { ...((broken.captions as { cues: unknown[] }).cues[0] as object), trackId: TRACK_VIDEO },
    ];
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a scene that references a clip that does not exist', () => {
    const broken = project();
    (broken.scenes as Array<Record<string, unknown>>)[0] = {
      ...((broken.scenes as Array<Record<string, unknown>>)[0] as Record<string, unknown>),
      clipIds: ['76767676-7676-4767-8767-767676767676'],
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a claim that cites a scene which does not exist', () => {
    const broken = project();
    (broken.provenance as { claims: Array<Record<string, unknown>> }).claims[0] = {
      ...((broken.provenance as { claims: Array<Record<string, unknown>> }).claims[0] as Record<string, unknown>),
      sceneId: '77777777-7777-4777-8777-777777777777',
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects an export variant that points at a missing render profile', () => {
    const broken = project();
    (broken.exportVariants as unknown[])[0] = {
      id: VARIANT_A,
      name: 'YouTube',
      renderProfileId: ASSET_VIDEO,
      platform: 'youtube',
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects music that references an asset the project does not hold', () => {
    const broken = project();
    (broken.audio as Record<string, unknown>).music = {
      assetId: '74747474-7474-4747-8747-747474747474',
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects ducking that names tracks which do not exist', () => {
    const broken = project();
    (broken.audio as Record<string, unknown>).ducking = {
      enabled: true,
      amountDb: -12,
      sourceTrackIds: [TRACK_NARRATION],
      targetTrackIds: ['75757575-7575-4757-8757-757575757575'],
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a project where updatedAt is earlier than createdAt', () => {
    expect(
      ProjectDocumentSchema.safeParse(
        project({ createdAt: '2026-10-18T11:00:00Z', updatedAt: '2026-10-18T10:00:00Z' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a root key that is not part of the format', () => {
    expect(ProjectDocumentSchema.safeParse(project({ providerKey: 'sk-live' })).success).toBe(false);
  });

  it('accepts an extension key in the reserved x- namespace', () => {
    expect(ProjectDocumentSchema.safeParse(project({ 'x-experiment': { flag: true } })).success).toBe(
      true,
    );
  });

  it('rejects a credential shaped key anywhere in the document', () => {
    const value = project({ 'x-notes': { apiKey: 'sk-live-123' } });
    const result = ProjectDocumentSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it('rejects a credential shaped key nested in an asset source', () => {
    const broken = project();
    (broken.assets as unknown[])[0] = {
      ...asset(ASSET_VIDEO, 'video', 'media/demo.mp4'),
      source: { type: 'local', path: 'media/demo.mp4', token: 'abc' },
    };
    expect(ProjectDocumentSchema.safeParse(broken).success).toBe(false);
  });
});

describe('createEmptyProject', () => {
  it('returns a project that validates with no content yet', () => {
    const empty = createEmptyProject('Proyecto nuevo', '2026-10-18T10:00:00Z');
    expect(ProjectDocumentSchema.safeParse(empty).success).toBe(true);
    expect(empty.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(empty.revision).toBe(0);
    expect(empty.assets).toHaveLength(0);
    expect(empty.timeline.clips).toHaveLength(0);
    expect(empty.scenes).toHaveLength(0);
  });

  it('refuses a blank project name', () => {
    expect(() => createEmptyProject('   ')).toThrow();
  });
});

describe('totalProjectDuration', () => {
  it('is the last frame touched by any clip or caption cue', () => {
    const parsed = ProjectDocumentSchema.parse(project());
    expect(totalProjectDuration(parsed)).toBe(450);
  });

  it('is zero for an empty project', () => {
    const parsed = ProjectDocumentSchema.parse(createEmptyProject('Vacío'));
    expect(totalProjectDuration(parsed)).toBe(0);
  });
});

describe('fixtures', () => {
  it('the empty fixture parses', () => {
    expect(ProjectDocumentSchema.safeParse(readFixture('empty-project.editoria.json')).success).toBe(
      true,
    );
  });

  it('the vertical slice fixture parses', () => {
    const fixture = readFixture('sample-vertical-slice.editoria.json');
    const result = ProjectDocumentSchema.safeParse(fixture);
    if (!result.success) {
      console.log(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('a malformed fixture is rejected with a useful message', () => {
    const fixture = readFixture('invalid-escaping-path.editoria.json');
    const result = parseProject(fixture);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.length).toBeGreaterThan(0);
  });

  it('a fixture written by a newer version names the version instead of failing blindly', () => {
    const fixture = readFixture('invalid-future-version.editoria.json');
    const result = parseProject(fixture);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });
});
