import type { ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf, totalFrames } from './project-actions';
import { serializeSrt } from './subtitles';

/**
 * Delivery package: one `.zip` a person can archive or hand to someone else.
 *
 * The package carries the portable project, the subtitle sidecar, the rights
 * table and a manifest. It deliberately does not copy media: an Olyvia
 * project references files by relative path and each asset already carries its
 * SHA-256, so duplicating gigabytes of video would add risk without adding
 * provenance. The readme says this in plain language.
 *
 * fflate se carga con `import()` dinámico: el compresor sólo baja cuando el
 * usuario pide el paquete, no en el arranque de la app.
 */

export const DELIVERY_PACKAGE_VERSION = 'editor-ia-delivery/1';

export interface DeliveryPackage {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly entries: readonly string[];
}

function slug(value: string): string {
  const folded = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return folded.length > 0 ? folded : 'proyecto';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function readme(project: ProjectDocument, generatedAt: string, hasSubtitles: boolean): string {
  return [
    'Olyvia — paquete de entrega',
    '',
    `Proyecto: ${project.name}`,
    `Generado: ${generatedAt}`,
    `Formato: ${DELIVERY_PACKAGE_VERSION}`,
    '',
    'Contenido:',
    '- proyecto.editoria.json: documento portable del proyecto.',
    ...(hasSubtitles ? ['- subtitulos.srt: pista principal de subtítulos en segundos.' ] : []),
    '- derechos.csv: licencia, uso comercial y procedencia de cada medio.',
    '- manifiesto.json: conteos, duración, perfiles y hashes declarados.',
    '',
    'Los medios no se copian dentro del paquete: el proyecto los referencia por',
    'ruta relativa y cada asset conserva su SHA-256. Para abrirlo, usá Archivo →',
    'Abrir proyecto… y elegí proyecto.editoria.json junto a la carpeta media/.',
    'Si movés el proyecto a otra máquina, copiá también la carpeta media/ con los',
    'mismos nombres y verificá los hashes antes de exportar.',
    '',
  ].join('\n');
}

export async function buildDeliveryPackage(
  project: ProjectDocument,
  generatedAt: Date = new Date(),
): Promise<DeliveryPackage> {
  const { strToU8, zipSync } = await import('fflate');
  const fps = fpsOf(project);
  const durationFrames = totalFrames(project);
  const generatedAtIso = generatedAt.toISOString();
  const cues = project.captions.cues;

  const files: Record<string, Uint8Array> = {};

  files['proyecto.editoria.json'] = strToU8(`${JSON.stringify(project, null, 2)}\n`);

  if (cues.length > 0) {
    files['subtitulos.srt'] = strToU8(
      serializeSrt(
        cues.map((cue) => ({
          startFrame: cue.startFrame,
          endFrame: cue.endFrame,
          text: cue.text,
        })),
        fps,
      ),
    );
  }

  const rightsRows: string[][] = [
    [
      'archivo',
      'etiqueta',
      'tipo',
      'estado',
      'licencia',
      'uso-comercial',
      'origen',
      'fuente',
      'fecha',
      'sha256',
      'bytes',
    ],
    ...project.assets.map((asset) => [
      asset.source.path,
      asset.label,
      asset.kind,
      asset.status,
      asset.rights.license.id,
      asset.rights.license.commercialUse,
      asset.rights.provenance.origin,
      asset.rights.provenance.sourceUrl ?? '',
      asset.rights.provenance.acquiredAt,
      asset.integrity?.sha256 ?? '',
      asset.integrity ? String(asset.integrity.bytes) : '',
    ]),
  ];
  files['derechos.csv'] = strToU8(csv(rightsRows));

  const manifest = {
    schema: DELIVERY_PACKAGE_VERSION,
    generatedAt: generatedAtIso,
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      revision: project.revision,
      width: project.video.width,
      height: project.video.height,
      frameRate: `${project.video.frameRate.num}/${project.video.frameRate.den}`,
      durationFrames,
      durationSeconds: Number((durationFrames / fps).toFixed(3)),
    },
    counts: {
      assets: project.assets.length,
      tracks: project.timeline.tracks.length,
      clips: project.timeline.clips.length,
      markers: project.markers.length,
      captionCues: cues.length,
      scenes: project.scenes.length,
      renderProfiles: project.renderProfiles.length,
      exportVariants: project.exportVariants.length,
    },
    assets: project.assets.map((asset) => ({
      label: asset.label,
      kind: asset.kind,
      path: asset.source.path,
      status: asset.status,
      sha256: asset.integrity?.sha256 ?? null,
      bytes: asset.integrity?.bytes ?? null,
      license: asset.rights.license.id,
      commercialUse: asset.rights.license.commercialUse,
      origin: asset.rights.provenance.origin,
      sourceUrl: asset.rights.provenance.sourceUrl ?? null,
    })),
  };
  files['manifiesto.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  files['LEEME.txt'] = strToU8(readme(project, generatedAtIso, cues.length > 0));

  const entries = Object.keys(files).sort();
  const bytes = zipSync(files, { level: 6 });
  return { fileName: `${slug(project.name)}-paquete.zip`, bytes, entries };
}
