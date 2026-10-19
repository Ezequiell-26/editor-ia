import { zodToJsonSchema } from 'zod-to-json-schema';
import { PROJECT_SCHEMA_VERSION, ProjectDocumentSchema } from './project.ts';

/**
 * Builds the machine readable JSON Schema for the project document. Shared by
 * the generator script and the drift test so neither can disagree with the
 * other about what "up to date" means.
 */

export function buildJsonSchemaDocument(): Record<string, unknown> {
  const generated = zodToJsonSchema(ProjectDocumentSchema, {
    // zod-to-json-schema 3.24 can only emit draft-07, 2019-09 and OpenAPI 3.
    // The artifact declares draft-07 rather than claiming a dialect the
    // generator silently ignored. Moving to 2020-12 means switching the
    // package to Zod 4 and its built-in toJSONSchema.
    target: 'jsonSchema7',
    // superRefine rules (timing equality, referential integrity, the x- key
    // namespace) have no JSON Schema form. "input" emits the shape the
    // refinement wraps, so the document is a necessary but not sufficient
    // validation of a project file.
    effectStrategy: 'input',
  }) as Record<string, unknown>;

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://editor-ia.local/schema/project-document.v${PROJECT_SCHEMA_VERSION}.json`,
    title: 'Editor IA project document',
    description:
      'Canonical .editoria.json contract. Referential integrity between entities, the x- key namespace and the credential-field ban are enforced by the validator code and cannot be expressed in JSON Schema.',
    ...generated,
  };
}
