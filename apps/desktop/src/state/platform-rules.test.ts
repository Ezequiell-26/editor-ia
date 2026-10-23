import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery } from './project-actions';
import {
  BUILTIN_RULE_PACKS,
  auditProjectForPlatform,
  mergeRulePacks,
  normalizeRulePack,
  parseRulesDocument,
} from './platform-rules';
import { readyAsset } from '../test/fake-service';

const NOW = '2026-10-20T00:00:00.000Z';

function base(): ProjectDocument {
  return ensureDelivery(createEmptyProject('Reglas', NOW));
}

function unknownRightsProject(): ProjectDocument {
  const asset = readyAsset({
    rights: {
      license: { id: 'unknown', commercialUse: 'unknown' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
  });
  return addAsset(base(), asset);
}

describe('reglas de plataforma', () => {
  it('valida y normaliza packs remotos sin aceptar datos arbitrarios', () => {
    const raw = BUILTIN_RULE_PACKS[0]!;
    const parsed = normalizeRulePack({ ...raw, label: '  YouTube actualizado  ' });
    expect(parsed?.label).toBe('YouTube actualizado');
    expect(parsed?.sources.length).toBeGreaterThan(0);
    expect(normalizeRulePack({ id: '', label: 'x' })).toBeNull();
    expect(normalizeRulePack({ id: 'x', label: 'x', orientation: 'rara', minHeight: -5 })?.minHeight).toBe(240);
  });

  it('parsea el documento público y reemplaza packs por id', () => {
    const basePack = BUILTIN_RULE_PACKS[0]!;
    const document = parseRulesDocument({
      schema: 'editor-ia.platform-rules.v1',
      generatedAt: '2026-10-21',
      packs: [{ ...basePack, version: '2026.10.21', maxDurationSeconds: 60 }],
    });
    expect(document).not.toBeNull();
    const merged = mergeRulePacks(BUILTIN_RULE_PACKS, document!.packs);
    expect(merged).toHaveLength(BUILTIN_RULE_PACKS.length);
    expect(merged.find((pack) => pack.id === basePack.id)?.version).toBe('2026.10.21');
    expect(parseRulesDocument({ schema: 'otro', packs: [] })).toBeNull();
  });

  it('bloquea derechos sin resolver y avisa por el formato vertical', () => {
    const shorts = BUILTIN_RULE_PACKS.find((pack) => pack.id === 'shorts')!;
    const findings = auditProjectForPlatform(unknownRightsProject(), shorts);
    expect(findings.some((finding) => finding.id === 'licenses' && finding.severity === 'block')).toBe(
      true,
    );
    expect(
      findings.some((finding) => finding.id === 'orientation' && finding.severity === 'warn'),
    ).toBe(true);
  });

  it('marca la divulgación de IA y la falta de subtítulos', () => {
    const asset = readyAsset({
      rights: {
        license: { id: 'user-declared', commercialUse: 'allowed' },
        provenance: {
          origin: 'generated-by-provider',
          acquiredAt: NOW,
          provider: 'flow',
        },
      },
    });
    const project = addAsset(base(), asset);
    const findings = auditProjectForPlatform(
      project,
      BUILTIN_RULE_PACKS.find((pack) => pack.id === 'youtube')!,
    );
    expect(findings.some((finding) => finding.id === 'ai-disclosure')).toBe(true);
    expect(findings.some((finding) => finding.id === 'captions')).toBe(true);
  });
});
