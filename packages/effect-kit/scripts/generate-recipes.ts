import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_EFFECTS } from '../src/catalog/index.ts';

/**
 * Genera la tabla de recetas de export para el renderer nativo.
 *
 * El catálogo vive en TypeScript (una sola fuente de verdad); Rust necesita la
 * misma receta para armar la cadena de FFmpeg. Este script traduce una a la
 * otra. Se corre con `npm run effects:codegen` y el archivo generado se
 * commitea: el build de Rust no depende de Node.
 */

const TARGET = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'desktop',
  'src-tauri',
  'src',
  'render',
  'effect_recipes.rs',
);

function rustString(value: string): string {
  return JSON.stringify(value);
}

function paramKind(type: string): string {
  switch (type) {
    case 'int':
      return 'ParamKind::Int';
    case 'bool':
      return 'ParamKind::Bool';
    case 'enum':
      return 'ParamKind::Enum';
    case 'color':
      return 'ParamKind::Color';
    case 'vec2':
      return 'ParamKind::Vec2';
    case 'float':
    default:
      return 'ParamKind::Float';
  }
}

const lines: string[] = [];
lines.push('//! Tabla de recetas de export, generada desde `@editor-ia/effect-kit`.');
lines.push('//!');
lines.push('//! NO EDITAR A MANO. Se regenera con `npm run effects:codegen`.');
lines.push('//! El catálogo y el compilador de preview viven en TypeScript; esta tabla');
lines.push('//! es la misma receta traducida para que el render nativo no dependa de Node.');
lines.push('');
lines.push('#[derive(Clone, Copy, PartialEq, Eq)]');
lines.push('pub enum ParamKind {');
lines.push('    Float,');
lines.push('    Int,');
lines.push('    Bool,');
lines.push('    Enum,');
lines.push('    Color,');
lines.push('    Vec2,');
lines.push('}');
lines.push('');
lines.push('pub struct RecipeParam {');
lines.push('    pub id: &\'static str,');
lines.push('    pub kind: ParamKind,');
lines.push('}');
lines.push('');
lines.push('pub struct Recipe {');
lines.push('    pub id: &\'static str,');
lines.push('    pub chain: &\'static [&\'static str],');
lines.push('    pub graph: Option<&\'static str>,');
lines.push('    /// Cadena de audio (efectos `kind: audio`). Vacía en los de video.');
lines.push('    pub audio_chain: &\'static [&\'static str],');
lines.push('    pub params: &\'static [RecipeParam],');
lines.push('}');
lines.push('');
lines.push('pub static RECIPES: &[Recipe] = &[');

let count = 0;
let audioCount = 0;
for (const manifest of ALL_EFFECTS) {
  const recipe = manifest.ffmpeg;
  const audio = manifest.audio;
  if (!recipe && !audio) continue;
  const chain = (recipe?.chain ?? []).map((item) => rustString(item)).join(', ');
  const audioChain = (audio?.chain ?? []).map((item) => rustString(item)).join(', ');
  const params = manifest.params
    .map((param) => `RecipeParam { id: ${rustString(param.id)}, kind: ${paramKind(param.type)} }`)
    .join(', ');
  lines.push('    Recipe {');
  lines.push(`        id: ${rustString(manifest.id)},`);
  lines.push(`        chain: &[${chain}],`);
  lines.push(`        graph: ${recipe?.graph ? `Some(${rustString(recipe.graph)})` : 'None'},`);
  lines.push(`        audio_chain: &[${audioChain}],`);
  lines.push(`        params: &[${params}],`);
  lines.push('    },');
  count += 1;
  if (audio) audioCount += 1;
}

lines.push('];');
lines.push('');
lines.push('pub fn find(id: &str) -> Option<&\'static Recipe> {');
lines.push('    RECIPES.iter().find(|recipe| recipe.id == id)');
lines.push('}');
lines.push('');

writeFileSync(TARGET, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(
  `effect_recipes.rs escrito con ${count} recetas (${audioCount} de audio)\n`,
);
