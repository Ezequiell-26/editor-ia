import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, JsonValueSchema } from './primitives.ts';

/**
 * Provenance: sources, claims and the reversible operations an agent proposes.
 *
 * Nothing an agent does to a project is applied as free text or as a shell
 * command. It is a versioned JSON Patch against the project document, kept in
 * the file with the cost that produced it and the revision it expected, so a
 * human can review, revert, or replay it after a crash.
 */

export const SourceKindSchema = z.enum([
  'web',
  'paper',
  'dataset',
  'interview',
  'product-docs',
  'transcript',
]);

export const ReliabilitySchema = z.enum(['primary', 'secondary', 'unverified']);

export const SourceSchema = z
  .object({
    id: EntityIdSchema,
    kind: SourceKindSchema,
    title: z.string().min(1).max(300),
    url: z.string().url().optional(),
    publisher: z.string().min(1).max(200).optional(),
    accessedAt: IsoDateTimeSchema,
    reliability: ReliabilitySchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.kind === 'web' && !item.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'a web source must record the address it was read from',
      });
    }
  });

export const ClaimStatusSchema = z.enum(['unverified', 'verified', 'contradicted']);

export const ClaimSchema = z
  .object({
    id: EntityIdSchema,
    text: z.string().min(1).max(1_000),
    status: ClaimStatusSchema,
    sourceIds: z.array(EntityIdSchema).max(50),
    sceneId: EntityIdSchema.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.status !== 'unverified' && item.sourceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceIds'],
        message: `a ${item.status} claim must cite at least one recorded source`,
      });
    }
  });

const JsonPointerSchema = z
  .string()
  .startsWith('/', 'patch paths must be JSON pointers rooted at the document')
  .refine(
    (value) => !value.split('/').includes('..'),
    'a patch path must not walk outside the project document',
  );

export const JsonPatchOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      path: JsonPointerSchema,
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('replace'),
      path: JsonPointerSchema,
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('remove'),
      path: JsonPointerSchema,
    })
    .strict(),
]);

export const AgentRoleSchema = z.enum([
  'planner',
  'researcher',
  'scriptwriter',
  'asset-scout',
  'editor',
  'motion-designer',
  'audio-subtitle',
  'qa-reviewer',
  'coordinator',
]);

export const OperationStatusSchema = z.enum(['proposed', 'applied', 'reverted', 'failed']);

const CostUnitSchema = z.enum(['tokens', 'seconds', 'calls', 'bytes', 'images']);

const CostItemSchema = z
  .object({
    kind: CostUnitSchema,
    amount: z.number().int().gte(0),
    unitLabel: z.string().min(1).max(40),
    estimatedUsdCents: z.number().int().gte(0).optional(),
  })
  .strict();

const CostRecordSchema = z
  .object({
    items: z.array(CostItemSchema).max(20),
    disclosed: z.boolean(),
    approved: z.boolean(),
  })
  .strict();

export const AgentOperationSchema = z
  .object({
    id: EntityIdSchema,
    role: AgentRoleSchema,
    summary: z.string().min(1).max(300),
    createdAt: IsoDateTimeSchema,
    provider: z
      .object({ id: z.string().min(1).max(80), model: z.string().min(1).max(120) })
      .strict()
      .optional(),
    cost: CostRecordSchema,
    patch: z.array(JsonPatchOperationSchema).min(1).max(500),
    expectedRevision: z.number().int().gte(0),
    appliedStatus: OperationStatusSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.appliedStatus !== 'applied') {
      return;
    }
    if (!item.cost.disclosed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cost', 'disclosed'],
        message: 'an applied operation must record that its cost was shown to the user',
      });
    }
    if (item.cost.items.length > 0 && !item.cost.approved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cost', 'approved'],
        message: 'a paid operation cannot be applied without user approval',
      });
    }
  });

export const ProvenanceRecordSchema = z
  .object({
    sources: z.array(SourceSchema),
    claims: z.array(ClaimSchema),
    operations: z.array(AgentOperationSchema),
  })
  .strict()
  .superRefine((record, ctx) => {
    const sourceIds = new Set<string>();
    for (const [index, item] of record.sources.entries()) {
      if (sourceIds.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sources', index, 'id'],
          message: 'source ids must be unique inside a project',
        });
      }
      sourceIds.add(item.id);
    }

    const claimIds = new Set<string>();
    for (const [index, claim] of record.claims.entries()) {
      if (claimIds.has(claim.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'id'],
          message: 'claim ids must be unique inside a project',
        });
      }
      claimIds.add(claim.id);

      const unknown = claim.sourceIds.filter((id) => !sourceIds.has(id));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'sourceIds'],
          message: `claim cites source ${unknown[0]} which is not recorded in the project`,
        });
      }
    }

    const operationIds = new Set<string>();
    for (const [index, operation] of record.operations.entries()) {
      if (operationIds.has(operation.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['operations', index, 'id'],
          message: 'operation ids must be unique inside a project',
        });
      }
      operationIds.add(operation.id);
    }
  });

export type Source = z.infer<typeof SourceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type AgentOperation = z.infer<typeof AgentOperationSchema>;
