#!/usr/bin/env node
/**
 * Auditoría local de la integración Open Design.
 *
 * Verifica que el catálogo generado sea consistente, que cada entrada tenga sus
 * archivos, que las licencias sean permisivas y que no se hayan colado scripts
 * ni runtimes. No sustituye la revisión legal, pero evita regresiones silenciosas.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = join(root, 'apps/desktop/public/open-design');
const catalogPath = join(base, 'catalog.json');
const failures = [];
const checks = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  else checks.push(message);
}

function exists(path) {
  return existsSync(path);
}

function file(path) {
  return join(base, path);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const allowedLicenses = new Set(['CC-BY-4.0', 'Apache-2.0', 'MIT', 'BSD']);
const licenseAllowed = (value) =>
  allowedLicenses.has(value) || value === 'Open Design (Apache-2.0)';

check(catalog.counts.designSystems === catalog.designSystems.length, 'conteo de sistemas');
check(catalog.counts.craft === catalog.craft.length, 'conteo de craft');
check(catalog.counts.promptTemplates === catalog.promptTemplates.length, 'conteo de prompts');
check(catalog.counts.templates === catalog.templates.length, 'conteo de plantillas');
check(catalog.counts.skills === catalog.skills.length, 'conteo de skills');
check(catalog.counts.hyperframes === catalog.hyperframes.length, 'conteo de HyperFrames');
check(
  catalog.counts.hyperframePreviews === (catalog.hyperframePreviews ?? []).length,
  'conteo de previews HyperFrames',
);

for (const system of catalog.designSystems) {
  check(exists(file(`design-systems/${system.id}/tokens.css`)), `tokens de ${system.id}`);
  check(exists(file(`design-systems/${system.id}/DESIGN.md`)), `guía de ${system.id}`);
  if (system.files.designTokens) {
    check(
      exists(file(`design-systems/${system.id}/${system.files.designTokens}`)),
      `tokens JSON de ${system.id}`,
    );
  }
  if (system.files.components) {
    check(
      exists(file(`design-systems/${system.id}/${system.files.components}`)),
      `componentes de ${system.id}`,
    );
  }
  for (const preview of system.previewPages) {
    check(
      exists(file(`design-systems/${system.id}/${preview.path}`)),
      `preview ${system.id}/${preview.path}`,
    );
  }
}

for (const prompt of catalog.promptTemplates) {
  check(exists(file(prompt.file)), `prompt ${prompt.id}`);
  check(licenseAllowed(prompt.license), `licencia de prompt ${prompt.id}: ${prompt.license}`);
  const detail = JSON.parse(readFileSync(file(prompt.file), 'utf8'));
  check(typeof detail.prompt === 'string' && detail.prompt.length > 0, `prompt vacío ${prompt.id}`);
}

for (const template of catalog.templates) {
  check(exists(file(template.files.skill)), `receta ${template.id}`);
  check(
    /MIT|Apache|CC-BY/.test(template.license),
    `licencia de plantilla ${template.id}: ${template.license}`,
  );
  if (template.files.license) {
    check(exists(file(template.files.license)), `LICENSE de plantilla ${template.id}`);
  }
}

for (const skill of catalog.skills) {
  check(exists(file(skill.files.skill)), `skill ${skill.id}`);
  check(licenseAllowed(skill.license), `licencia de skill ${skill.id}: ${skill.license}`);
  if (skill.files.license) {
    check(exists(file(skill.files.license)), `LICENSE de skill ${skill.id}`);
  }
}

for (const hyperframe of catalog.hyperframes) {
  check(exists(file(hyperframe.html)), `HTML de ${hyperframe.id}`);
  check(exists(file(hyperframe.preview)), `preview de ${hyperframe.id}`);
  const html = readFileSync(file(hyperframe.html), 'utf8');
  const external = html
    .replaceAll('http://www.w3.org', '')
    .match(/https?:\/\//g)?.length ?? 0;
  check(!/<script\b/i.test(html), `scripts en ${hyperframe.id}`);
  check(external === 0, `recursos remotos en ${hyperframe.id}`);
  check(hyperframe.width > 0 && hyperframe.height > 0, `tamaño de ${hyperframe.id}`);
}

for (const preview of catalog.hyperframePreviews ?? []) {
  check(exists(file(preview.video)), `video de preview ${preview.id}`);
  check(exists(file(preview.preview)), `imagen de preview ${preview.id}`);
}

for (const license of ['shrikhand', 'librebaskerville', 'spacegrotesk']) {
  check(
    exists(file(`hyperframes/licenses/${license}-OFL.txt`)),
    `licencia de fuente ${license}`,
  );
}

const allowedExtensions = new Set([
  'html',
  'css',
  'json',
  'md',
  'txt',
  'woff2',
  'woff',
  'ttf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'mp4',
]);

function walk(current) {
  const problems = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      problems.push(...walk(full));
      continue;
    }
    if (entry.name === 'LICENSE' || entry.name === 'NOTICE') continue;
    const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (!allowedExtensions.has(extension)) {
      problems.push(relative(base, full).replace(/\\/g, '/'));
    }
  }
  return problems;
}

const unexpected = walk(base);
check(unexpected.length === 0, `archivos no permitidos: ${unexpected.slice(0, 8).join(', ')}`);

const files = [];
function countFiles(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) countFiles(full);
    else files.push(full);
  }
}
countFiles(base);
const bytes = files.reduce((total, path) => total + statSync(path).size, 0);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      checks: checks.length,
      failures,
      catalog: catalog.counts,
      files: files.length,
      megabytes: Number((bytes / 1_048_576).toFixed(1)),
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exit(1);
