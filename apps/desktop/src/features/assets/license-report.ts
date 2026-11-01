import type { ProjectDocument } from '@editor-ia/project-schema';

function cell(value: string | undefined | null): string {
  const text = (value ?? '').trim();
  if (text === '') return '—';
  return text.replace(/\|/g, '\\|');
}

/**
 * Inventario de derechos de los medios del proyecto. Es la evidencia que pide
 * la distribución comercial: origen, fecha, licencia, uso y atribución por
 * asset, sin inventar datos que el proyecto no tenga.
 */
export function buildAssetLicenseReport(project: ProjectDocument): string {
  const lines = [
    '# Inventario de medios',
    '',
    '| Medio | Tipo | Origen | Adquirido | Proveedor | Licencia | Uso comercial | Atribución |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const asset of project.assets) {
    const { license, provenance } = asset.rights;
    lines.push(
      `| ${cell(asset.label)} | ${cell(asset.kind)} | ${cell(provenance.origin)} | ${cell(
        provenance.acquiredAt.slice(0, 10),
      )} | ${cell(provenance.provider)} | ${cell(license.id)} | ${cell(
        license.commercialUse,
      )} | ${cell(license.attributionText)} |`,
    );
  }
  if (project.assets.length === 0) {
    lines.push('', '_Sin medios importados._');
  }
  lines.push(
    '',
    `Medios auditados: ${project.assets.length}. Fuente: proyecto abierto en Editor IA / Olyvia.`,
  );
  return lines.join('\n');
}
