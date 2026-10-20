import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, addScene, ensureDelivery, newId } from './project-actions';
import { auditPublication, buildPublicationManifest } from './publication';

const NOW = '2026-10-19T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

function image(label: string, sha: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.png` },
    status: 'ready',
    integrity: { sha256: sha.repeat(64), bytes: 1000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function generatedAudio(): Asset {
  return {
    id: newId(),
    label: 'voz.mp3',
    kind: 'audio',
    source: {
      type: 'generated',
      provider: { id: 'elevenlabs', model: 'eleven_multilingual_v2' },
      path: 'media/voz.mp3',
      generatedAt: NOW,
    },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 2000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: {
        origin: 'generated-by-provider',
        acquiredAt: NOW,
        provider: 'elevenlabs',
      },
    },
    media: { sampleRate: 44_100, channels: 1, durationFrames: 90 },
  } as Asset;
}

function projectWithIssues(): ProjectDocument {
  let project = validated(ensureDelivery(createEmptyProject('Fábrica', NOW)));
  project = addAsset(project, image('a', 'a'));
  project = addAsset(project, image('b', 'a'));
  project = addAsset(project, generatedAudio());
  const added = addScene(project, {
    title: 'Hook',
    intent: 'hook',
    narration: 'Texto de prueba.',
  });
  project = added.project;
  project.assets.push({
    id: newId(),
    label: 'perdido.png',
    kind: 'image',
    source: { type: 'local', path: 'media/perdido.png' },
    status: 'missing',
    rights: {
      license: { id: 'unknown', commercialUse: 'unknown' },
      provenance: { origin: 'downloaded', acquiredAt: NOW, sourceUrl: 'https://example.com/x' },
    },
  } as Asset);
  return project;
}

describe('auditoría de publicación', () => {
  it('detecta duplicados, licencias desconocidas, material faltante e IA', () => {
    const audit = auditPublication(projectWithIssues());

    expect(audit.checks.duplicateGroups).toBe(1);
    expect(audit.checks.missingLicenses).toBe(1);
    expect(audit.checks.allAssetsReady).toBe(false);
    expect(audit.checks.aiGeneratedAssets).toBe(1);
    expect(audit.checks.scenes).toBe(1);
    expect(audit.checks.captionCount).toBe(0);
    expect(audit.score).toBeLessThan(100);
    expect(audit.issues.join(' ')).toMatch(/duplicad/i);
    expect(audit.issues.join(' ')).toMatch(/licencia/i);
  });

  it('un proyecto completo y consistente obtiene 100', () => {
    let project = validated(ensureDelivery(createEmptyProject('Limpio', NOW)));
    project = addAsset(project, image('a', 'd'));
    const audit = auditPublication(project);

    expect(audit.checks.duplicateGroups).toBe(0);
    expect(audit.checks.missingLicenses).toBe(0);
    expect(audit.checks.allAssetsReady).toBe(true);
    expect(audit.score).toBe(100);
  });
});

describe('manifiesto de publicación', () => {
  it('incluye derechos, hashes, procedencia y no contiene claves', () => {
    const manifest = buildPublicationManifest(projectWithIssues(), new Date(NOW));
    const text = JSON.stringify(manifest);

    expect(manifest.schema).toBe('editor-ia.publication-manifest.v1');
    expect(manifest.generatedAt).toBe(NOW);
    expect(manifest.assets).toHaveLength(4);
    expect(manifest.assets[0]?.integrity?.sha256).toHaveLength(64);
    expect(manifest.assets.some((asset) => asset.provenance?.origin === 'generated-by-provider')).toBe(true);
    expect(manifest.delivery.profiles).toBeGreaterThan(0);
    expect(manifest.audit.score).toBeLessThan(100);
    expect(text).not.toMatch(/api[_-]?key|xi-api-key|authorization/i);
  });

  it('sugiere título, descripción, hashtags, capítulos y encaje por plataforma', () => {
    const manifest = buildPublicationManifest(projectWithIssues(), new Date(NOW));
    const metadata = manifest.metadata;

    expect(metadata.title).toBe('Hook');
    expect(metadata.description).toContain('Texto de prueba.');
    expect(metadata.hashtags.length).toBeGreaterThan(0);
    expect(metadata.chapters).toEqual([{ startSeconds: 0, title: 'Hook' }]);
    const youtube = metadata.platforms.find((platform) => platform.id === 'youtube');
    const shorts = metadata.platforms.find((platform) => platform.id === 'shorts');
    expect(youtube?.fits).toBe(true);
    expect(shorts?.fits).toBe(false);
    expect(shorts?.reason).toMatch(/9:16/);
  });
});
