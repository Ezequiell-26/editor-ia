import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import { buildAssetLicenseReport } from './license-report';

describe('buildAssetLicenseReport', () => {
  it('lista origen, licencia, uso y atribución de cada medio', () => {
    const base = ensureDelivery(createEmptyProject('Inventario', '2026-10-30T00:00:00.000Z'));
    const asset = readyAsset();
    const project = addAsset(base, {
      ...asset,
      rights: {
        license: {
          id: 'CC-BY-4.0',
          commercialUse: 'requires-attribution',
          attributionText: 'Autor | Obra',
        },
        provenance: {
          origin: 'downloaded',
          acquiredAt: '2026-10-20T12:00:00.000Z',
          provider: 'Internet Archive',
        },
      },
    });
    const report = buildAssetLicenseReport(project);
    expect(report).toContain('| Medio | Tipo | Origen | Adquirido | Proveedor | Licencia |');
    expect(report).toContain('CC-BY-4.0');
    expect(report).toContain('requires-attribution');
    expect(report).toContain('Autor \\| Obra');
    expect(report).toContain('Internet Archive');
    expect(report).toContain('2026-10-20');
    expect(report).toContain('Medios auditados: 1');
  });

  it('declara un proyecto sin medios', () => {
    const project = ensureDelivery(createEmptyProject('Vacío', '2026-10-30T00:00:00.000Z'));
    const report = buildAssetLicenseReport(project);
    expect(report).toContain('_Sin medios importados._');
    expect(report).toContain('Medios auditados: 0');
  });
});
