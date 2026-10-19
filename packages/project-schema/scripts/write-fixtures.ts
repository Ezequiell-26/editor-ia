import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyProject, ProjectDocumentSchema } from '../src/project.ts';

/**
 * Writes the fixtures the test suite reads. Run with:
 *   npm run fixtures:write
 * Regenerate after changing the format, never edit the JSON by hand.
 */

const fixturesDir = join(import.meta.dirname, '..', 'fixtures');

const ASSET_VIDEO = '41414141-4141-4414-8414-414141414141';
const ASSET_VOICE = '42424242-4242-4424-8424-424242424242';
const TRACK_VIDEO = '43434343-4343-4434-8434-434343434343';
const TRACK_NARRATION = '44444444-4444-4444-8444-444444444444';
const TRACK_CAPTIONS = '45454545-4545-4454-8454-454545454544';
const CLIP_A = '46464646-4646-4464-8464-464646464644';
const CLIP_B = '47474747-4747-4474-8474-474747474744';
const SCENE_A = '48484848-4848-4484-8484-484848484844';
const MOTION_A = '49494949-4949-4494-8494-494949494944';
const STYLE_A = '4a4a4a4a-4a4a-44aa-8aaa-aaaaaaaaaaa4';
const CUE_A = '4b4b4b4b-4b4b-44bb-8bbb-bbbbbbbbbbb4';
const PROFILE_WIDE = '4c4c4c4c-4c4c-44cc-8ccc-ccccccccccca';
const PROFILE_TALL = '4c4c4c4c-4c4c-44cc-8ccc-cccccccccccb';
const TRACK_GRAPHIC = '52525252-5252-4525-8525-525252525252';
const CLIP_GRAPHIC = '53535353-5353-4535-8535-535353535353';
const VARIANT_A = '4d4d4d4d-4d4d-44dd-8ddd-ddddddddddd4';
const SOURCE_A = '4e4e4e4e-4e4e-44ee-8eee-eeeeeeeeeee4';
const CLAIM_A = '4f4f4f4f-4f4f-44ff-8fff-fffffffffffc';
const OPERATION_A = '50505050-5050-4500-8500-505050505050';

function qualityGate(minOutputBytes: number) {
  return {
    minOutputBytes,
    durationToleranceFrames: 3,
    requireAllAssetsReady: true,
  };
}

const sample = {
  id: '60606060-6060-4606-8606-606060606060',
  name: 'Vertical slice de prueba',
  schemaVersion: 1,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T11:00:00Z',
  revision: 4,
  language: 'es',
  video: {
    width: 1920,
    height: 1080,
    frameRate: { num: 30, den: 1 },
    backgroundColor: '#101014',
    safeArea: { top: 120, right: 60, bottom: 220, left: 60 },
  },
  assets: [
    {
      id: ASSET_VIDEO,
      kind: 'video',
      label: 'Grabación de pantalla',
      source: {
        type: 'downloaded',
        url: 'https://example.com/demo.mp4',
        path: 'media/demo.mp4',
        fetchedAt: '2026-10-18T09:40:00Z',
      },
      status: 'ready',
      integrity: { sha256: 'b'.repeat(64), bytes: 2_000_000 },
      media: {
        width: 1920,
        height: 1080,
        durationFrames: 900,
        frameRate: { num: 30, den: 1 },
      },
      rights: {
        license: {
          id: 'CC0-1.0',
          commercialUse: 'allowed',
          url: 'https://creativecommons.org/publicdomain/zero/1.0/',
        },
        provenance: {
          origin: 'downloaded',
          acquiredAt: '2026-10-18T09:40:00Z',
          sourceUrl: 'https://example.com/demo.mp4',
          termsSnapshot: 'CC0 1.0 Universal, no attribution required',
        },
      },
    },
    {
      id: ASSET_VOICE,
      kind: 'audio',
      label: 'Narración escena 1',
      source: { type: 'local', path: 'media/narracion-escena-1.wav' },
      status: 'ready',
      integrity: { sha256: 'c'.repeat(64), bytes: 1_000_000 },
      media: { sampleRate: 48000, channels: 1, durationFrames: 600 },
      rights: {
        license: { id: 'owned-by-user', commercialUse: 'allowed' },
        provenance: { origin: 'user-imported', acquiredAt: '2026-10-18T10:00:00Z' },
      },
    },
  ],
  timeline: {
    tracks: [
      { id: TRACK_VIDEO, kind: 'video', label: 'V1', order: 0 },
      { id: TRACK_NARRATION, kind: 'narration', label: 'N1', order: 1 },
      { id: TRACK_CAPTIONS, kind: 'caption', label: 'C1', order: 2 },
      { id: TRACK_GRAPHIC, kind: 'graphic', label: 'G1', order: 3 },
    ],
    clips: [
      {
        id: CLIP_A,
        trackId: TRACK_VIDEO,
        kind: 'video',
        label: 'Toma 1',
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
        audio: { gainDb: -2, fadeInFrames: 5, fadeOutFrames: 10 },
      },
      {
        id: CLIP_GRAPHIC,
        trackId: TRACK_GRAPHIC,
        kind: 'graphic',
        startFrame: 30,
        durationFrames: 90,
        source: { type: 'graphic', motionId: MOTION_A },
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
        outlineColor: '#000000',
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
      clipIds: [CLIP_A, CLIP_B, CLIP_GRAPHIC],
    },
  ],
  motion: [
    {
      id: MOTION_A,
      template: { id: 'lower-third', version: '1.2.0', source: 'bundled' },
      props: { label: 'Editor IA', accentColor: '#3ddc97' },
      targetTrackId: TRACK_GRAPHIC,
    },
  ],
  audio: {
    master: { gainDb: 0, limiter: true },
    ducking: {
      enabled: false,
      amountDb: -12,
      sourceTrackIds: [TRACK_NARRATION],
      targetTrackIds: [TRACK_VIDEO],
    },
    loudnessTarget: {
      platform: 'youtube',
      integratedLufs: -13.8,
      truePeakDb: -1.5,
      toleranceDb: 1,
    },
  },
  renderProfiles: [
    {
      id: PROFILE_WIDE,
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
      qualityGate: qualityGate(1_000_000),
    },
    {
      id: PROFILE_TALL,
      name: 'Shorts 1080x1920',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      resolution: { width: 1080, height: 1920 },
      frameRate: { num: 30, den: 1 },
      bitrate: { mode: 'target', videoBitsPerSecond: 8_000_000 },
      pixelFormat: 'yuv420p',
      audioSampleRate: 48000,
      audioChannels: 2,
      aspectRatio: '9:16',
      qualityGate: qualityGate(500_000),
    },
  ],
  exportVariants: [
    { id: VARIANT_A, name: 'YouTube', renderProfileId: PROFILE_WIDE, platform: 'youtube' },
    {
      id: '51515151-5151-4515-8515-515151515151',
      name: 'Shorts',
      renderProfileId: PROFILE_TALL,
      platform: 'shorts',
    },
  ],
  provenance: {
    sources: [
      {
        id: SOURCE_A,
        kind: 'product-docs',
        title: 'Matriz de contenedores y códecs',
        accessedAt: '2026-10-18T09:00:00Z',
        reliability: 'primary',
      },
    ],
    claims: [
      {
        id: CLAIM_A,
        text: 'h264 en mp4 con yuv420p se reproduce en los cuatro destinos',
        status: 'verified',
        sourceIds: [SOURCE_A],
        sceneId: SCENE_A,
      },
    ],
    operations: [
      {
        id: OPERATION_A,
        role: 'editor',
        summary: 'Alinea la narración con la toma 1',
        createdAt: '2026-10-18T10:30:00Z',
        provider: { id: 'local', model: 'none' },
        cost: { items: [], disclosed: true, approved: false },
        patch: [{ op: 'replace', path: '/timeline/clips/1/startFrame', value: 120 }],
        expectedRevision: 3,
        appliedStatus: 'applied',
      },
    ],
  },
  migrationHistory: [],
};

function write(name: string, value: unknown) {
  writeFileSync(join(fixturesDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

const parsed = ProjectDocumentSchema.parse(sample);

mkdirSync(fixturesDir, { recursive: true });
write('empty-project.editoria.json', createEmptyProject('Proyecto vacío de prueba', '2026-10-18T10:00:00Z'));
write('sample-vertical-slice.editoria.json', parsed);

const escapingPath = structuredClone(parsed);
const firstAsset = escapingPath.assets[0];
if (!firstAsset) {
  throw new Error('la muestra de proyecto debe tener al menos un asset');
}
firstAsset.source.path = 'media/../../../../etc/passwd';
write('invalid-escaping-path.editoria.json', escapingPath);

const futureVersion: Record<string, unknown> = structuredClone(parsed);
futureVersion.schemaVersion = 2;
write('invalid-future-version.editoria.json', futureVersion);

console.log('fixtures written to', fixturesDir);
