#!/usr/bin/env node
/**
 * Sincroniza los recursos portables de Open Design (Apache-2.0) dentro de
 * Olyvia: sistemas de diseño, reglas de craft, plantillas de prompt y
 * plantillas de diseño como recetas.
 *
 * No copia el repositorio completo: sólo los contratos públicos de cada
 * paquete (manifest.json, DESIGN.md, tokens.css, componentes y previews),
 * excluyendo `source/` (evidencia interna), las plantillas de prompt sin
 * licencia declarada y las recetas copyleft o con upstream sin licencia.
 *
 * Uso:
 *   node scripts/sync-open-design.mjs --source D:/DevCache/open-design
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith('--')) args.set(value.slice(2), process.argv[index + 1] ?? '');
}
const source = resolve(args.get('source') ?? 'D:/DevCache/open-design');
const destination = resolve(args.get('dest') ?? join(repoRoot, 'apps/desktop/public/open-design'));

const DESIGN_FILES = [
  'manifest.json',
  'DESIGN.md',
  'USAGE.md',
  'tokens.css',
  'design-tokens.json',
  'tailwind-v4.css',
  'components.html',
  'components.manifest.json',
];
const CRAFT_FILES = [
  'accessibility-baseline.md',
  'animation-discipline.md',
  'anti-ai-slop.md',
  'color.md',
  'form-validation.md',
  'laws-of-ux.md',
  'rtl-and-bidi.md',
  'state-coverage.md',
  'typography-hierarchy-editorial.md',
  'typography-hierarchy.md',
  'typography.md',
];
const PROMPT_LICENSES = new Set(['CC-BY-4.0', 'Apache-2.0', 'MIT']);
const TOKEN_KEYS = ['bg', 'surface', 'surface-warm', 'fg', 'fg-2', 'muted', 'meta', 'border', 'border-soft', 'accent', 'accent-on', 'success', 'warn', 'danger'];

function fail(message) {
  console.error(`[open-design] ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Campos que necesitamos del frontmatter YAML, sin traer un parser entero. */
function metadataOf(markdown) {
  const clean = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = clean.match(/^---\n([\s\S]*?)\n---/);
  const lines = match ? match[1].split('\n') : [];
  const scalar = (key) => {
    const prefix = `${key}:`;
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (!line) return null;
    return line.slice(prefix.length).trim().replace(/^["']|["']$/g, '') || null;
  };
  const block = (key) => {
    const start = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (start < 0) return null;
    const values = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      if (/^\S/.test(line)) break;
      values.push(line.replace(/^ {2}/, ''));
    }
    return values.join(' ').trim() || null;
  };
  const list = (key) => {
    const start = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (start < 0) return [];
    const values = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      if (/^\S/.test(line)) break;
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item) values.push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
    return values;
  };
  const od = {};
  const odStart = lines.findIndex((line) => /^od:\s*$/.test(line));
  if (odStart >= 0) {
    for (let index = odStart + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\S/.test(line)) break;
      const field = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (field) od[field[1]] = field[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return {
    name: scalar('name'),
    description: block('description') ?? scalar('description'),
    triggers: list('triggers'),
    mode: od.mode ?? null,
    platform: od.platform ?? null,
    scenario: od.scenario ?? null,
    category: od.category ?? null,
    upstream: od.upstream ?? null,
  };
}

function licenseOf(dir) {
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8').slice(0, 4_000);
    if (/AGPL|GNU Affero/i.test(text)) {
      return { label: 'AGPL', file, permissive: false };
    }
    if (/GPL-3|GPLv3|GNU General Public License/i.test(text)) {
      return { label: 'GPL', file, permissive: false };
    }
    if (/MIT License|Permission is hereby granted/i.test(text)) {
      return { label: 'MIT', file, permissive: true };
    }
    if (/Apache License/i.test(text)) {
      return { label: 'Apache-2.0', file, permissive: true };
    }
    if (/CC-BY-4\.0|Creative Commons Attribution 4\.0/i.test(text)) {
      return { label: 'CC-BY-4.0', file, permissive: true };
    }
    if (/BSD/i.test(text)) {
      return { label: 'BSD', file, permissive: true };
    }
    return { label: 'Ver LICENSE', file, permissive: true };
  }
  return { label: null, file: null, permissive: true };
}

function isPreviewable(html) {
  return !/<script\b/i.test(html) && !/(?:src|href)\s*=\s*["']https?:/i.test(html);
}

/**
 * Un ejemplo puede delegar en otro HTML local (p. ej. assets/template.html).
 * Se revisan todos los HTML del paquete para no declarar segura una preview
 * que en realidad depende de scripts o recursos remotos.
 */
function isPreviewableDir(dir) {
  const htmlFiles = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(full);
    }
  };
  walk(dir);
  if (htmlFiles.length === 0) return false;
  return htmlFiles.every((file) => isPreviewable(readFileSync(file, 'utf8')));
}

function copyTreeIfExists(from, to) {
  if (!existsSync(from) || !statSync(from).isDirectory()) return false;
  cpSync(from, to, { recursive: true });
  return true;
}

function parseTokens(css) {
  const map = new Map();
  for (const match of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

function colorValue(tokens, key) {
  const value = tokens.get(key);
  if (!value) return null;
  // Sólo valores sólidos: los color-mix/var() no sirven como muestra directa.
  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|rgba|hsl|hsla|oklch|lab|lch|oklab)\(/i.test(value)) {
    return value;
  }
  return null;
}

function hexFrom(value) {
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const body = hex[1];
    return `#${body.length === 3 ? body.split('').map((part) => part + part).join('') : body}`.toLowerCase();
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i.exec(value);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function paletteOf(tokens) {
  const colors = {};
  for (const key of TOKEN_KEYS) {
    const value = colorValue(tokens, key);
    if (value) colors[key] = value;
  }
  const canvas = {
    bg: hexFrom(colors.bg),
    surface: hexFrom(colors.surface),
    fg: hexFrom(colors.fg),
    accent: hexFrom(colors.accent),
    accentOn: hexFrom(colors['accent-on']),
  };
  return { colors, canvas };
}

function firstHeading(markdown) {
  const line = markdown.split(/\r?\n/).find((candidate) => /^#\s+/.test(candidate));
  return line ? line.replace(/^#\s+/, '').trim() : null;
}

function firstParagraph(markdown) {
  const blocks = markdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith('#') && !block.startsWith('---') && !block.startsWith('>'));
  const block = blocks[0] ?? '';
  return block.replace(/\n/g, ' ').slice(0, 260);
}

function copyIfExists(from, to) {
  if (!existsSync(from) || !statSync(from).isFile()) return false;
  mkdirSync(resolve(to, '..'), { recursive: true });
  cpSync(from, to);
  return true;
}

function walkFiles(root, base = root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, base));
    else if (entry.isFile()) files.push(relative(base, full).replace(/\\/g, '/'));
  }
  return files;
}

if (!existsSync(join(source, 'design-systems'))) fail(`no encuentro design-systems en ${source}`);
if (!existsSync(join(repoRoot, 'apps/desktop/public'))) fail('falta apps/desktop/public');

let commit = 'desconocido';
try {
  commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Sin git se conserva el catálogo, con la fuente sin commit.
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

const designSystems = [];
const designRoot = join(source, 'design-systems');
for (const dirName of readdirSync(designRoot).sort()) {
  if (dirName.startsWith('_')) continue;
  const dir = join(designRoot, dirName);
  if (!statSync(dir).isDirectory()) continue;
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  const id = manifest.id || dirName;
  const tokensPath = join(dir, manifest.files?.tokens ?? 'tokens.css');
  if (!existsSync(tokensPath)) continue;
  const tokens = parseTokens(readFileSync(tokensPath, 'utf8'));
  const target = join(destination, 'design-systems', id);
  mkdirSync(target, { recursive: true });
  for (const file of DESIGN_FILES) copyIfExists(join(dir, file), join(target, file));
  if (existsSync(join(dir, 'preview'))) {
    cpSync(join(dir, 'preview'), join(target, 'preview'), { recursive: true });
  }
  for (const extra of ['LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']) {
    copyIfExists(join(dir, extra), join(target, extra));
  }
  const previewPages = Array.isArray(manifest.preview?.pages)
    ? manifest.preview.pages.map((page) => ({
        path: page.path,
        role: page.role ?? 'page',
        title: page.title ?? page.role ?? 'Vista previa',
      }))
    : [];
  const { colors, canvas } = paletteOf(tokens);
  designSystems.push({
    id,
    name: manifest.name ?? id,
    category: manifest.category ?? 'Sin categoría',
    description: manifest.description ?? '',
    colors,
    canvas,
    fonts: {
      display: tokens.get('font-display') ?? null,
      body: tokens.get('font-body') ?? null,
      mono: tokens.get('font-mono') ?? null,
    },
    craft: {
      applies: Array.isArray(manifest.craft?.applies) ? manifest.craft.applies : [],
      suggested: Array.isArray(manifest.craft?.suggested) ? manifest.craft.suggested : [],
    },
    previewPages,
    hasComponents: existsSync(join(dir, 'components.html')),
    files: {
      design: existsSync(join(dir, 'DESIGN.md')) ? 'DESIGN.md' : null,
      tokens: 'tokens.css',
      designTokens: existsSync(join(dir, 'design-tokens.json')) ? 'design-tokens.json' : null,
      components: existsSync(join(dir, 'components.html')) ? 'components.html' : null,
    },
  });
}

const craftRoot = join(source, 'craft');
const craft = [];
mkdirSync(join(destination, 'craft'), { recursive: true });
for (const file of CRAFT_FILES) {
  const from = join(craftRoot, file);
  if (!existsSync(from)) continue;
  cpSync(from, join(destination, 'craft', file));
  const markdown = readFileSync(from, 'utf8');
  const id = basename(file, '.md');
  craft.push({
    id,
    title: firstHeading(markdown) ?? id,
    summary: firstParagraph(markdown),
    file,
    bytes: Buffer.byteLength(markdown),
  });
}

const promptsRoot = join(source, 'prompt-templates');
const promptTemplates = [];
let excludedPrompts = 0;
mkdirSync(join(destination, 'prompt-templates'), { recursive: true });
for (const surface of ['image', 'video']) {
  const dir = join(promptsRoot, surface);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const full = join(dir, file);
    const data = readJson(full);
    const license = data.source?.license ?? 'sin licencia';
    if (!PROMPT_LICENSES.has(license)) {
      excludedPrompts += 1;
      continue;
    }
    cpSync(full, join(destination, 'prompt-templates', surface, file), {
      recursive: false,
    });
    if (existsSync(join(promptsRoot, surface, file.replace(/\.json$/, '.preview.png')))) {
      cpSync(
        join(promptsRoot, surface, file.replace(/\.json$/, '.preview.png')),
        join(destination, 'prompt-templates', surface, file.replace(/\.json$/, '.preview.png')),
      );
    }
    promptTemplates.push({
      id: data.id ?? basename(file, '.json'),
      surface,
      title: data.title ?? data.id ?? file,
      summary: data.summary ?? '',
      category: data.category ?? 'General',
      tags: Array.isArray(data.tags) ? data.tags : [],
      model: data.model ?? null,
      aspect: data.aspect ?? null,
      license,
      author: data.source?.author ?? null,
      sourceUrl: data.source?.url ?? null,
      file: `prompt-templates/${surface}/${file}`,
      preview: existsSync(join(promptsRoot, surface, file.replace(/\.json$/, '.preview.png')))
        ? `prompt-templates/${surface}/${file.replace(/\.json$/, '.preview.png')}`
        : null,
    });
  }
}


// Plantillas de imagen/video de los plugins oficiales: el prompt vive en
// template.json y su licencia se declara en open-design.json. Se normalizan al
// mismo contrato que las plantillas de prompt para que la biblioteca las trate
// igual (búsqueda, filtro, atribución y handoff a Imagen IA/Guion).
const mediaRoot = join(source, 'plugins', '_official');
const existingPromptIds = new Set(promptTemplates.map((entry) => entry.id));
for (const surface of ['image', 'video']) {
  const dirRoot = join(mediaRoot, `${surface}-templates`);
  if (!existsSync(dirRoot)) continue;
  for (const dirName of readdirSync(dirRoot).sort()) {
    const dir = join(dirRoot, dirName);
    if (!statSync(dir).isDirectory()) continue;
    const templatePath = join(dir, 'template.json');
    const metaPath = join(dir, 'open-design.json');
    if (!existsSync(templatePath) || !existsSync(metaPath)) continue;
    const template = readJson(templatePath);
    const meta = readJson(metaPath);
    const license = meta.license ?? template.source?.license;
    if (!PROMPT_LICENSES.has(license)) {
      excludedPrompts += 1;
      continue;
    }
    const prompt = typeof template.prompt === 'string' ? template.prompt.trim() : '';
    if (!prompt) continue;
    const baseId = `media-${surface}-${template.id ?? dirName}`;
    let id = baseId;
    let suffix = 2;
    while (existingPromptIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    existingPromptIds.add(id);
    const normalized = {
      id,
      title: template.title ?? meta.title ?? id,
      summary: template.summary ?? meta.description ?? '',
      category: template.category ?? 'General',
      tags: Array.isArray(template.tags) ? template.tags : [],
      model: template.model ?? null,
      aspect: template.aspect ?? null,
      prompt,
      source: {
        repo: template.source?.repo ?? meta.homepage ?? null,
        license,
        author:
          template.source?.author ??
          (typeof meta.author === 'string' ? meta.author : meta.author?.name) ??
          null,
        url: template.source?.url ?? meta.author?.url ?? null,
      },
    };
    mkdirSync(join(destination, 'prompt-templates', surface), { recursive: true });
    const fileName = `${id}.json`;
    writeFileSync(
      join(destination, 'prompt-templates', surface, fileName),
      `${JSON.stringify(normalized, null, 2)}
`,
    );
    promptTemplates.push({
      id,
      surface,
      title: normalized.title,
      summary: normalized.summary,
      category: normalized.category,
      tags: normalized.tags,
      model: normalized.model,
      aspect: normalized.aspect,
      license,
      author: normalized.source.author,
      sourceUrl: normalized.source.url,
      file: `prompt-templates/${surface}/${fileName}`,
      preview: null,
    });
  }
}

const templatesRoot = join(source, 'design-templates');
const templates = [];
let excludedTemplates = 0;
if (existsSync(templatesRoot)) {
  mkdirSync(join(destination, 'templates'), { recursive: true });
  for (const dirName of readdirSync(templatesRoot).sort()) {
    if (dirName.startsWith('_')) continue;
    const dir = join(templatesRoot, dirName);
    if (!statSync(dir).isDirectory()) continue;
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const markdown = readFileSync(skillPath, 'utf8');
    const metadata = metadataOf(markdown);
    const license = licenseOf(dir);
    if (!license.permissive || (!license.label && metadata.upstream)) {
      excludedTemplates += 1;
      continue;
    }
    const id = dirName;
    const target = join(destination, 'templates', id);
    mkdirSync(target, { recursive: true });
    const examplePath = join(dir, 'example.html');
    const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
    const previewable = Boolean(example) && isPreviewableDir(dir);
    if (previewable) {
      // El ejemplo puede depender de CSS, imágenes o assets locales: se copia
      // el paquete completo para que la preview no quede a medias.
      cpSync(dir, target, { recursive: true });
    } else {
      copyIfExists(skillPath, join(target, 'SKILL.md'));
      if (example) copyIfExists(examplePath, join(target, 'example.html'));
      for (const extra of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'ASSET-SOURCES.md', 'SOURCES.md', 'README.md', 'open-design.json']) {
        copyIfExists(join(dir, extra), join(target, extra));
      }
    }
    const licenseFile = license.file && existsSync(join(target, license.file)) ? license.file : null;
    templates.push({
      id,
      name: metadata.name ?? id,
      description: metadata.description ?? firstParagraph(markdown.replace(/^---\n[\s\S]*?\n---\n?/, '')),
      mode: metadata.mode ?? 'template',
      platform: metadata.platform,
      scenario: metadata.scenario,
      category: metadata.category,
      tags: metadata.triggers.slice(0, 8),
      upstream: metadata.upstream,
      license: license.label ?? 'Open Design (Apache-2.0)',
      licenseFile,
      hasExample: Boolean(example),
      previewable,
      files: {
        skill: `templates/${id}/SKILL.md`,
        example: example ? `templates/${id}/example.html` : null,
        license: licenseFile ? `templates/${id}/${licenseFile}` : null,
      },
    });
  }
}

const skillsRoot = join(source, 'skills');
const skills = [];
let excludedSkills = 0;
if (existsSync(skillsRoot)) {
  mkdirSync(join(destination, 'skills'), { recursive: true });
  for (const dirName of readdirSync(skillsRoot).sort()) {
    if (dirName.startsWith('_')) continue;
    const dir = join(skillsRoot, dirName);
    if (!statSync(dir).isDirectory()) continue;
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const markdown = readFileSync(skillPath, 'utf8');
    const metadata = metadataOf(markdown);
    const license = licenseOf(dir);
    if (!license.permissive || (!license.label && metadata.upstream)) {
      excludedSkills += 1;
      continue;
    }
    const id = dirName;
    const target = join(destination, 'skills', id);
    mkdirSync(target, { recursive: true });
    const htmlPath = join(dir, 'example.html');
    const exampleHtml = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
    const previewable = Boolean(exampleHtml) && isPreviewableDir(dir);
    if (previewable) {
      cpSync(dir, target, { recursive: true });
    } else {
      copyIfExists(skillPath, join(target, 'SKILL.md'));
      for (const extra of [
        'example.html',
        'example.md',
        'LICENSE',
        'LICENSE.md',
        'LICENSE.txt',
        'ASSET-SOURCES.md',
        'SOURCES.md',
        'README.md',
      ]) {
        copyIfExists(join(dir, extra), join(target, extra));
      }
    }
    const exampleFile = ['example.html', 'example.md'].find((file) =>
      existsSync(join(target, file)),
    );
    const licenseFile =
      license.file && existsSync(join(target, license.file)) ? license.file : null;
    skills.push({
      id,
      name: metadata.name ?? id,
      description: metadata.description ?? firstParagraph(markdown.replace(/^---\n[\s\S]*?\n---\n?/, '')),
      mode: metadata.mode ?? 'utility',
      platform: metadata.platform,
      scenario: metadata.scenario,
      category: metadata.category,
      tags: metadata.triggers.slice(0, 8),
      upstream: metadata.upstream,
      license: license.label ?? 'Open Design (Apache-2.0)',
      licenseFile,
      hasExample: Boolean(exampleFile),
      previewable,
      generatorReady: metadata.mode !== 'utility',
      files: {
        skill: `skills/${id}/SKILL.md`,
        example: exampleFile ? `skills/${id}/${exampleFile}` : null,
        license: licenseFile ? `skills/${id}/${licenseFile}` : null,
      },
    });
  }
}


// Ejemplos oficiales que no están en design-templates ni en skills. Los que
// son recetas estáticas (decks y páginas) se ofrecen como plantillas; los que
// dependen de WebGL/GSAP/Remotion quedan como referencia de solo lectura. Sólo
// se copia SKILL.md y LICENSE: no se traen scripts, videos ni assets pesados.
const existingTemplateIds = new Set(templates.map((entry) => entry.id));
const existingSkillIds = new Set(skills.map((entry) => entry.id));
const examplesRoot = join(source, 'plugins', '_official', 'examples');
if (existsSync(examplesRoot)) {
  for (const name of readdirSync(examplesRoot).sort()) {
    const dir = join(examplesRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    if (existingTemplateIds.has(name) || existingSkillIds.has(name)) continue;
    const manifestPath = join(dir, 'open-design.json');
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(manifestPath) || !existsSync(skillPath)) continue;
    const manifest = readJson(manifestPath);
    if (!PROMPT_LICENSES.has(manifest.license)) continue;
    const metadata = metadataOf(readFileSync(skillPath, 'utf8'));
    const mode = manifest.od?.mode ?? 'prototype';
    const runtimeDependent =
      mode === 'video' ||
      mode === 'utility' ||
      name.startsWith('webgl-') ||
      name.startsWith('motion-') ||
      name.startsWith('od-plugin') ||
      name === 'open-design-homepage' ||
      name === 'codex-interactive-capability-map';
    const target = runtimeDependent
      ? join(destination, 'skills', `example-${name}`)
      : join(destination, 'templates', name);
    mkdirSync(target, { recursive: true });
    copyIfExists(skillPath, join(target, 'SKILL.md'));
    const licenseFile = [ 'LICENSE', 'LICENSE.md', 'LICENSE.txt' ].find((file) =>
      existsSync(join(dir, file)),
    );
    if (licenseFile) copyIfExists(join(dir, licenseFile), join(target, licenseFile));
    const description =
      manifest.description ??
      metadata.description ??
      firstParagraph(readFileSync(skillPath, 'utf8'));
    if (runtimeDependent) {
      const id = `example-${name}`;
      skills.push({
        id,
        name: manifest.title ?? metadata.name ?? name,
        description: `${description} Requiere runtime con WebGL/GSAP/Remotion; se incluye sólo como referencia.`,
        mode: 'utility',
        platform: null,
        scenario: 'example',
        category: 'Open Design · runtime example',
        tags: Array.isArray(manifest.tags) ? manifest.tags.slice(0, 8) : [],
        upstream: manifest.author?.name ?? 'Open Design contributors',
        license: manifest.license,
        licenseFile: licenseFile ?? null,
        hasExample: false,
        previewable: false,
        generatorReady: false,
        files: {
          skill: `skills/${id}/SKILL.md`,
          example: null,
          license: licenseFile ? `skills/${id}/${licenseFile}` : null,
        },
      });
    } else {
      templates.push({
        id: name,
        name: manifest.title ?? metadata.name ?? name,
        description,
        mode,
        platform: null,
        scenario: 'example',
        category: 'Open Design · example',
        tags: Array.isArray(manifest.tags) ? manifest.tags.slice(0, 8) : [],
        upstream: manifest.author?.name ?? 'Open Design contributors',
        license: manifest.license,
        licenseFile: licenseFile ?? null,
        hasExample: false,
        previewable: false,
        files: {
          skill: `templates/${name}/SKILL.md`,
          example: null,
          license: licenseFile ? `templates/${name}/${licenseFile}` : null,
        },
      });
      existingTemplateIds.add(name);
    }
  }
}

// Scenarios y atoms oficiales: documentación de flujos de Open Design (MIT).
// Se copian como referencia de solo lectura; no son recetas del generador.
for (const [kind, dirName] of [
  ['scenario', 'scenarios'],
  ['atom', 'atoms'],
]) {
  const root = join(source, 'plugins', '_official', dirName);
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'open-design.json');
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(manifestPath) || !existsSync(skillPath)) continue;
    const manifest = readJson(manifestPath);
    if (!PROMPT_LICENSES.has(manifest.license)) {
      excludedSkills += 1;
      continue;
    }
    const id = `workflow-${manifest.name ?? name}`;
    const target = join(destination, 'skills', id);
    cpSync(dir, target, { recursive: true });
    // Las skills son referencia, no código ejecutable: no se distribuyen sus
    // scripts de Python ni binarios auxiliares.
    for (const unwanted of ['scripts', 'bin']) {
      const path = join(target, unwanted);
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    }
    const metadata = metadataOf(readFileSync(skillPath, 'utf8'));
    const licenseFile = existsSync(join(target, 'LICENSE')) ? 'LICENSE' : null;
    skills.push({
      id,
      name: manifest.title ?? metadata.name ?? name,
      description:
        manifest.description ??
        metadata.description ??
        firstParagraph(readFileSync(skillPath, 'utf8')),
      mode: 'utility',
      platform: null,
      scenario: 'workflow',
      category: kind === 'scenario' ? 'Open Design · scenario' : 'Open Design · atom',
      tags: Array.isArray(manifest.tags) ? manifest.tags.slice(0, 8) : [],
      upstream: 'Open Design contributors',
      license: manifest.license,
      licenseFile,
      hasExample: false,
      previewable: false,
      generatorReady: false,
      files: {
        skill: `skills/${id}/SKILL.md`,
        example: null,
        license: licenseFile ? `skills/${id}/${licenseFile}` : null,
      },
    });
  }
}

// Skills comunitarias con licencia permisiva (MIT). Se copian como referencia
// completa; las que no declaran licencia o son andamiaje de pruebas quedan fuera.
const communityRoot = join(source, 'plugins', 'community');
if (existsSync(communityRoot)) {
  const scaffold = new Set(['import-smoke-test', 'registry-starter']);
  for (const dirName of readdirSync(communityRoot).sort()) {
    const dir = join(communityRoot, dirName);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'open-design.json');
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(manifestPath) || !existsSync(skillPath)) continue;
    const manifest = readJson(manifestPath);
    if (!PROMPT_LICENSES.has(manifest.license) || scaffold.has(dirName)) {
      excludedSkills += 1;
      continue;
    }
    const id = manifest.name?.startsWith('community-')
      ? manifest.name
      : `community-${manifest.name ?? dirName}`;
    const target = join(destination, 'skills', id);
    cpSync(dir, target, { recursive: true });
    // Las skills son referencia, no código ejecutable: no se distribuyen sus
    // scripts de Python ni binarios auxiliares.
    for (const unwanted of ['scripts', 'bin']) {
      const path = join(target, unwanted);
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    }
    const metadata = metadataOf(readFileSync(skillPath, 'utf8'));
    const mode = id.endsWith('humanize-ppt')
      ? 'deck'
      : id.endsWith('hallmark')
        ? 'design'
        : 'utility';
    const licenseFile = existsSync(join(target, 'LICENSE')) ? 'LICENSE' : null;
    skills.push({
      id,
      name: manifest.title ?? metadata.name ?? id,
      description: manifest.description ?? metadata.description ?? firstParagraph(readFileSync(skillPath, 'utf8')),
      mode,
      platform: null,
      scenario: 'community',
      category: 'Community',
      tags: Array.isArray(manifest.tags) ? manifest.tags.slice(0, 8) : [],
      upstream: manifest.author?.name ?? null,
      license: manifest.license,
      licenseFile,
      hasExample: false,
      previewable: false,
      generatorReady: mode !== 'utility',
      files: {
        skill: `skills/${id}/SKILL.md`,
        example: null,
        license: licenseFile ? `skills/${id}/${licenseFile}` : null,
      },
    });
  }
}

// Composiciones HyperFrames autocontenidas: HTML + CSS @keyframes + fuentes
// locales, sin scripts ni GSAP. Se copian sólo las que Olyvia puede renderizar
// de verdad con WebCodecs; las que dependen de scripts o Remotion se excluyen.
const hyperframes = [];
const hyperframePreviews = [];
let excludedHyperframes = 0;
const hyperRoot = join(source, 'plugins', '_official', 'video-templates');
if (existsSync(hyperRoot)) {
  for (const dirName of readdirSync(hyperRoot).sort()) {
    const dir = join(hyperRoot, dirName);
    if (!statSync(dir).isDirectory()) continue;
    const templatePath = join(dir, 'template.json');
    const metaPath = join(dir, 'open-design.json');
    if (!existsSync(templatePath) || !existsSync(metaPath)) continue;
    const template = readJson(templatePath);
    const meta = readJson(metaPath);
    if ((template.prompt ?? '').trim()) continue;
    const sourceEntry = template.sourceEntry ?? 'source/index.html';
    const htmlPath = join(dir, sourceEntry);
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, 'utf8');
    const license = template.source?.license ?? meta.license;
    const scripts = /<script/i.test(html);
    const external = html
      .replaceAll('http://www.w3.org', '')
      .match(/https?:\/\//g)?.length ?? 0;
    const renderable =
      template.engine === 'hyperframes' &&
      !scripts &&
      external === 0 &&
      PROMPT_LICENSES.has(license);
    if (!renderable) {
      const previewVideo = join(dir, 'preview.mp4');
      if (
        template.engine === 'hyperframes' &&
        PROMPT_LICENSES.has(license) &&
        existsSync(previewVideo)
      ) {
        const previewId = template.id ?? dirName;
        const previewTarget = join(destination, 'hyperframes', 'previews', previewId);
        mkdirSync(previewTarget, { recursive: true });
        copyIfExists(previewVideo, join(previewTarget, 'preview.mp4'));
        copyIfExists(join(dir, 'preview.png'), join(previewTarget, 'preview.png'));
        copyIfExists(templatePath, join(previewTarget, 'template.json'));
        copyIfExists(join(dir, 'SKILL.md'), join(previewTarget, 'SKILL.md'));
        const previewAspect = template.aspect === '9:16' ? '9:16' : '16:9';
        hyperframePreviews.push({
          id: previewId,
          title: template.title ?? previewId,
          summary: template.summary ?? '',
          category: template.category ?? 'General',
          tags: Array.isArray(template.tags) ? template.tags : [],
          aspect: previewAspect,
          durationSec:
            Number(template.durationSec) > 0 ? Number(template.durationSec) : 15,
          license,
          author: template.source?.author ?? null,
          sourceUrl: template.source?.url ?? null,
          preview: `hyperframes/previews/${previewId}/preview.png`,
          video: `hyperframes/previews/${previewId}/preview.mp4`,
          reason: scripts ? 'scripts' : external > 0 ? 'recursos remotos' : 'runtime no portable',
        });
      }
      excludedHyperframes += 1;
      continue;
    }
    const id = template.id ?? dirName;
    const target = join(destination, 'hyperframes', id);
    mkdirSync(join(target, 'source'), { recursive: true });
    copyIfExists(htmlPath, join(target, 'source', 'index.html'));
    copyIfExists(join(dir, 'source', 'fonts.css'), join(target, 'source', 'fonts.css'));
    if (existsSync(join(dir, 'source', 'fonts'))) {
      cpSync(join(dir, 'source', 'fonts'), join(target, 'source', 'fonts'), {
        recursive: true,
      });
    }
    copyIfExists(join(dir, 'preview.png'), join(target, 'preview.png'));
    copyIfExists(join(dir, 'SKILL.md'), join(target, 'SKILL.md'));
    const aspect = template.aspect === '9:16' ? '9:16' : '16:9';
    hyperframes.push({
      id,
      title: template.title ?? id,
      summary: template.summary ?? '',
      category: template.category ?? 'General',
      tags: Array.isArray(template.tags) ? template.tags : [],
      aspect,
      width: aspect === '9:16' ? 1080 : 1920,
      height: aspect === '9:16' ? 1920 : 1080,
      fps: Number(template.fps) > 0 ? Number(template.fps) : 30,
      durationSec: Number(template.durationSec) > 0 ? Number(template.durationSec) : 15,
      license,
      author: template.source?.author ?? null,
      sourceUrl: template.source?.url ?? null,
      preview: `hyperframes/${id}/preview.png`,
      html: `hyperframes/${id}/source/index.html`,
    });
  }
}

const fontLicenses = join(repoRoot, 'scripts', 'assets', 'font-licenses');
if (existsSync(fontLicenses)) {
  cpSync(fontLicenses, join(destination, 'hyperframes', 'licenses'), { recursive: true });
}

const catalog = {
  schemaVersion: 'olyvia-open-design/v1',
  source: {
    repo: 'https://github.com/nexu-io/open-design',
    commit,
    license: 'Apache-2.0',
    syncedAt: new Date().toISOString(),
  },
  counts: {
    designSystems: designSystems.length,
    craft: craft.length,
    promptTemplates: promptTemplates.length,
    excludedPromptTemplates: excludedPrompts,
    templates: templates.length,
    excludedTemplates,
    skills: skills.length,
    excludedSkills,
    hyperframes: hyperframes.length,
    hyperframePreviews: hyperframePreviews.length,
    excludedHyperframes,
  },
  craft,
  promptTemplates,
  templates,
  skills,
  hyperframes,
  hyperframePreviews,
  designSystems,
};

writeFileSync(join(destination, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

const craftLicense = readFileSync(join(craftRoot, 'color.md'), 'utf8').match(/Adapted from[\s\S]{0,200}?\(MIT\)/);
const notice = `# Open Design · aviso de atribución

Estos recursos provienen de **Open Design** (<https://github.com/nexu-io/open-design>),
licenciado bajo Apache License 2.0. Commit sincronizado: \`${commit}\`.

Olyvia incluye una selección portable de ese proyecto:

- ${designSystems.length} paquetes de sistemas de diseño (manifiesto, DESIGN.md, tokens.css, componentes y previews).
- ${craft.length} reglas de craft.
- ${promptTemplates.length} plantillas de prompt con licencia declarada (CC-BY-4.0, Apache-2.0 o MIT),
  incluidas 45 plantillas de imagen y 40 de video de los plugins oficiales.
  Se excluyeron ${excludedPrompts} plantillas sin licencia reutilizable.
- ${templates.length} plantillas de diseño como recetas de generación; ${excludedTemplates}
  quedaron fuera por licencia copyleft o por depender de un upstream sin licencia
  verificable. Cada receta conserva su licencia, archivo LICENSE y enlace de origen
  en \`catalog.json\`. Las previews sólo se muestran cuando el ejemplo no carga
  scripts ni recursos remotos.
- ${skills.length} skills como biblioteca de referencia; ${excludedSkills} quedaron
  fuera por las mismas reglas. Las skills con modo \`utility\` son sólo lectura:
  no se ofrecen como receta del generador de diseño.
- ${hyperframes.length} composiciones HyperFrames autocontenidas (HTML + CSS
  @keyframes + fuentes locales), licencia Apache-2.0, derivadas de
  frontend-slides (MIT). ${excludedHyperframes} quedaron fuera por usar scripts,
  Remotion o recursos remotos. Las fuentes son de Google Fonts (OFL-1.1) y se
  incluyen como archivos locales; el texto de cada licencia está en
  \`hyperframes/licenses/\`. No se ejecuta JavaScript en ellas.
- ${skills.filter((skill) => skill.scenario === 'community').length} skills
  comunitarias MIT (Hallmark y Humanize PPT) copiadas completas como referencia;
  las que no declaran licencia quedaron fuera. Hallmark conserva su LICENSE de
  Hallmark contributors y Humanize PPT el de LearnPrompt.
- ${skills.filter((skill) => skill.scenario === 'workflow').length} scenarios y
  atoms oficiales (MIT) copiados como documentación de flujo de solo lectura.
  No son recetas del generador.
- ${templates.filter((template) => template.scenario === 'example').length} recetas
  de ejemplo oficiales (decks y páginas) y
  ${skills.filter((skill) => skill.scenario === 'example').length} referencias de
  ejemplos con WebGL/GSAP/Remotion. De los ejemplos sólo se copian SKILL.md y
  LICENSE; no se traen scripts, videos ni assets.
- ${hyperframePreviews.length} previews MP4 de composiciones con scripts/GSAP,
  incluidas como **material de solo lectura** (Apache-2.0/MIT): no se ejecuta su
  runtime ni se puede editar la composición; sirven para descargar o montar el
  video ya renderizado. ${excludedHyperframes - hyperframePreviews.length}
  composición Remotion quedó fuera por completo.

Los archivos se copiaron sin modificaciones. Olyvia sólo agrega \`catalog.json\`
(índice generado) y esta nota. El código de Open Design no se copió: su runtime,
plugins y skills no forman parte de este paquete.

Las marcas, nombres comerciales y logotipos mencionados en los sistemas de
diseño pertenecen a sus titulares. Los tokens se usan como referencia visual y
no implican afiliación ni patrocinio.

${craftLicense ? 'Las reglas de craft incluyen adaptaciones de refero_skill (MIT), según se indica en cada archivo.\n' : ''}Cada plantilla de prompt conserva su licencia, autor y URL de origen en
\`catalog.json\` y en el JSON original.

El texto completo de Apache License 2.0 está en \`LICENSE\`.
`;

writeFileSync(join(destination, 'NOTICE.md'), notice);
const upstreamLicense = join(source, 'LICENSE');
if (existsSync(upstreamLicense)) {
  cpSync(upstreamLicense, join(destination, 'LICENSE'));
} else {
  writeFileSync(
    join(destination, 'LICENSE'),
    `Copyright 2026 Open Design contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`,
  );
}

const files = walkFiles(destination);
const bytes = files.reduce((total, file) => total + statSync(join(destination, file)).size, 0);
console.log(
  `[open-design] ${designSystems.length} sistemas, ${craft.length} craft, ${promptTemplates.length} prompts (${excludedPrompts} excluidos), ${hyperframes.length} HyperFrames + ${hyperframePreviews.length} previews (${excludedHyperframes} excluidos), ${(bytes / 1_048_576).toFixed(1)} MB, ${files.length} archivos`,
);
console.log(`[open-design] destino: ${destination}`);
