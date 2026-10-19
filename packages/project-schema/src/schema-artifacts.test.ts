import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from './project.ts';
import { buildJsonSchemaDocument } from './schema-document.ts';

/**
 * The committed JSON Schema is what the Rust boundary and the render worker
 * validate against, so it must never drift from the TypeScript contract.
 */

function committedSchema(): Record<string, any> {
  const path = join(
    import.meta.dirname,
    '..',
    'schema',
    `project-document.v${PROJECT_SCHEMA_VERSION}.schema.json`,
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('project-document JSON Schema', () => {
  it('is committed and matches the TypeScript schema exactly', () => {
    expect(committedSchema()).toEqual(buildJsonSchemaDocument());
  });

  it('declares the dialect the generator really emits', () => {
    const schema = committedSchema();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(
      `https://editor-ia.local/schema/project-document.v${PROJECT_SCHEMA_VERSION}.json`,
    );
  });

  it('requires every entity collection a project can hold', () => {
    const required: string[] = committedSchema().required;
    for (const key of [
      'assets',
      'timeline',
      'captions',
      'scenes',
      'motion',
      'audio',
      'renderProfiles',
      'exportVariants',
      'provenance',
      'migrationHistory',
    ]) {
      expect(required).toContain(key);
    }
  });

  it('pins the schema version to a single constant', () => {
    expect(committedSchema().properties.schemaVersion.const).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('states in the document which rules JSON Schema cannot carry', () => {
    expect(String(committedSchema().description)).toContain('cannot be expressed in JSON Schema');
  });
});
