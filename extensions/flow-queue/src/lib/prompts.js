/**
 * Prompt import rules for the Flow Queue extension.
 *
 * The reference workflow imports a plain .txt file with one image prompt per
 * line. Long prompts that need paragraphs can use a line containing only `---`
 * as a separator. Duplicates are removed case-insensitively after whitespace
 * normalization, so re-importing a script never generates the same image twice.
 */

export const MAX_PROMPTS = 500;
export const MAX_PROMPT_LENGTH = 4_000;

const SEPARATOR = /^\s*---+\s*$/;
const LIST_PREFIX = /^\s*(?:\d+[.)]|[-*•])\s+/;

export function normalizePrompt(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePrompts(text, options = {}) {
  const max = options.max ?? MAX_PROMPTS;
  const maxLength = options.maxLength ?? MAX_PROMPT_LENGTH;
  const warnings = [];
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const usesSeparators = lines.some((line) => SEPARATOR.test(line));

  let blocks;
  if (usesSeparators) {
    blocks = [];
    let current = [];
    for (const line of lines) {
      if (SEPARATOR.test(line)) {
        blocks.push(current.join(' '));
        current = [];
      } else {
        current.push(line);
      }
    }
    blocks.push(current.join(' '));
  } else {
    blocks = lines;
  }

  const prompts = [];
  const seen = new Set();
  let duplicates = 0;
  let truncated = 0;
  const nonEmptyBlocks = blocks.reduce(
    (count, block) => count + (normalizePrompt(block) ? 1 : 0),
    0,
  );

  for (const block of blocks) {
    let value = normalizePrompt(block);
    if (!value) {
      continue;
    }
    if (!usesSeparators) {
      value = value.replace(LIST_PREFIX, '').trim();
    }
    if (!value) {
      continue;
    }
    if (value.length > maxLength) {
      value = value.slice(0, maxLength).trim();
      truncated += 1;
    }
    const key = value.toLocaleLowerCase('es');
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    prompts.push(value);
    if (prompts.length >= max) {
      break;
    }
  }

  if (truncated > 0) {
    warnings.push(
      `${truncated} prompt(s) superaban ${maxLength} caracteres y se recortaron.`,
    );
  }
  if (nonEmptyBlocks > max) {
    warnings.push(
      `Se importaron como máximo ${max} prompts; el resto quedó fuera de la cola.`,
    );
  }
  if (prompts.length === 0) {
    warnings.push('El archivo no contiene prompts.');
  }

  return { prompts, warnings, duplicates };
}
