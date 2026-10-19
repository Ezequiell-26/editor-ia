import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_SCHEMA_VERSION } from '../src/project.ts';
import { buildJsonSchemaDocument } from '../src/schema-document.ts';

/**
 * Emits the machine readable contract for the project format.
 *
 * The JSON Schema is a build artifact of the TypeScript schema, not a second
 * hand written copy: the Rust boundary and the render worker validate project
 * files against this document, and a test fails if the committed copy drifts.
 */

const packageDir = join(import.meta.dirname, '..');
const schemaDir = join(packageDir, 'schema');

mkdirSync(schemaDir, { recursive: true });
writeFileSync(
  join(schemaDir, `project-document.v${PROJECT_SCHEMA_VERSION}.schema.json`),
  `${JSON.stringify(buildJsonSchemaDocument(), null, 2)}\n`,
);

console.log(`JSON Schema escrito en ${schemaDir}`);
