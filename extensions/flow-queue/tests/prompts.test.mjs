import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PROMPTS,
  normalizePrompt,
  parsePrompts,
} from '../src/lib/prompts.js';

test('imports one prompt per non-empty line and strips list numbering', () => {
  const result = parsePrompts(`
    1. Un faro en un acantilado, ilustración plana
    2) Un bosque de abedules al amanecer
    - Una ciudad flotante sobre el mar
  `);

  assert.deepEqual(result.prompts, [
    'Un faro en un acantilado, ilustración plana',
    'Un bosque de abedules al amanecer',
    'Una ciudad flotante sobre el mar',
  ]);
  assert.equal(result.duplicates, 0);
  assert.deepEqual(result.warnings, []);
});

test('normalizes CRLF, BOM and repeated whitespace before de-duplicating', () => {
  const result = parsePrompts('\uFEFFUn gato\r\n  un   gato  \r\n\r\nOtro gato\r\n');

  assert.deepEqual(result.prompts, ['Un gato', 'Otro gato']);
  assert.equal(result.duplicates, 1);
});

test('keeps multi-line prompts when separated by a --- line', () => {
  const result = parsePrompts(`
Primera escena:
un faro azul junto al mar
---
Segunda escena:
un faro al atardecer
  `);

  assert.deepEqual(result.prompts, [
    'Primera escena: un faro azul junto al mar',
    'Segunda escena: un faro al atardecer',
  ]);
});

test('reports empty input honestly', () => {
  const result = parsePrompts('   \n\n  ');

  assert.deepEqual(result.prompts, []);
  assert.deepEqual(result.warnings, ['El archivo no contiene prompts.']);
});

test('caps the queue and long prompts with explicit warnings', () => {
  const lines = Array.from({ length: MAX_PROMPTS + 2 }, (_, index) => `Prompt ${index + 1}`);
  const result = parsePrompts(lines.join('\n'));

  assert.equal(result.prompts.length, MAX_PROMPTS);
  assert.match(result.warnings.join(' '), /máximo/i);

  const long = parsePrompts('x'.repeat(10_000));
  assert.equal(long.prompts[0].length, 4_000);
  assert.match(long.warnings.join(' '), /recort/i);
});

test('normalizePrompt collapses runs of whitespace but keeps sentence spacing', () => {
  assert.equal(normalizePrompt('  uno\n\tdos   tres  '), 'uno dos tres');
});
