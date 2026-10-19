import { describe, expect, it } from 'vitest';
import {
  AgentOperationSchema,
  ClaimSchema,
  JsonPatchOperationSchema,
  ProvenanceRecordSchema,
  SourceSchema,
} from './provenance.ts';

const SOURCE = '31313131-3131-4313-8313-313131313131';
const CLAIM = '32323232-3232-4323-8323-323232323232';
const OPERATION = '34343434-3434-4343-8343-343434343434';
const SCENE = '35353535-3535-4353-8353-353535353535';

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE,
    kind: 'web',
    title: 'Documentación oficial del códec',
    url: 'https://example.com/docs',
    accessedAt: '2026-10-18T12:00:00Z',
    reliability: 'primary',
    ...overrides,
  };
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: CLAIM,
    text: 'El render de prueba tarda 30 segundos',
    status: 'unverified',
    sourceIds: [],
    ...overrides,
  };
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: OPERATION,
    role: 'editor',
    summary: 'Recorta el segundo clip',
    createdAt: '2026-10-18T12:00:00Z',
    patch: [{ op: 'remove', path: '/timeline/clips/1' }],
    expectedRevision: 3,
    appliedStatus: 'proposed',
    cost: { items: [], disclosed: true, approved: false },
    ...overrides,
  };
}

describe('SourceSchema', () => {
  it('accepts a web source with an access date', () => {
    expect(SourceSchema.safeParse(source()).success).toBe(true);
  });

  it('rejects a web source without the url it came from', () => {
    const payload = source();
    delete (payload as { url?: unknown }).url;
    expect(SourceSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts an interview source without a url', () => {
    expect(SourceSchema.safeParse(source({ kind: 'interview', url: undefined })).success).toBe(true);
  });

  it('rejects an unknown source kind', () => {
    expect(SourceSchema.safeParse(source({ kind: 'rumor' })).success).toBe(false);
  });

  it('rejects an access date that is not a timestamp', () => {
    expect(SourceSchema.safeParse(source({ accessedAt: 'ayer' })).success).toBe(false);
  });

  it('rejects an unknown source key', () => {
    expect(SourceSchema.safeParse(source({ apiKey: 'sk-123' })).success).toBe(false);
  });
});

describe('ClaimSchema', () => {
  it('accepts an unverified claim with no evidence yet', () => {
    expect(ClaimSchema.safeParse(claim()).success).toBe(true);
  });

  it('rejects a verified claim that cites no source', () => {
    expect(ClaimSchema.safeParse(claim({ status: 'verified' })).success).toBe(false);
  });

  it('accepts a verified claim backed by a source id', () => {
    expect(ClaimSchema.safeParse(claim({ status: 'verified', sourceIds: [SOURCE] })).success).toBe(
      true,
    );
  });

  it('rejects a contradicted claim that cites no source', () => {
    expect(ClaimSchema.safeParse(claim({ status: 'contradicted' })).success).toBe(false);
  });

  it('accepts a claim attached to a scene', () => {
    expect(ClaimSchema.safeParse(claim({ sceneId: SCENE })).success).toBe(true);
  });

  it('rejects an empty claim text', () => {
    expect(ClaimSchema.safeParse(claim({ text: '' })).success).toBe(false);
  });
});

describe('JsonPatchOperationSchema', () => {
  it('accepts an add operation with a value', () => {
    expect(
      JsonPatchOperationSchema.safeParse({
        op: 'add',
        path: '/assets/0',
        value: { kind: 'image' },
      }).success,
    ).toBe(true);
  });

  it('accepts a remove operation without a value', () => {
    expect(JsonPatchOperationSchema.safeParse({ op: 'remove', path: '/assets/0' }).success).toBe(
      true,
    );
  });

  it('rejects a remove operation that carries a value', () => {
    expect(
      JsonPatchOperationSchema.safeParse({ op: 'remove', path: '/assets/0', value: 1 }).success,
    ).toBe(false);
  });

  it('rejects an add operation with no value', () => {
    expect(JsonPatchOperationSchema.safeParse({ op: 'add', path: '/assets/0' }).success).toBe(false);
  });

  it('rejects a pointer that is not rooted at the document', () => {
    expect(JsonPatchOperationSchema.safeParse({ op: 'add', path: 'assets/0', value: 1 }).success)
      .toBe(false);
  });

  it('rejects a pointer that walks out of the project', () => {
    expect(
      JsonPatchOperationSchema.safeParse({ op: 'add', path: '/../secrets', value: 1 }).success,
    ).toBe(false);
  });

  it('rejects an empty pointer, which would replace the whole document', () => {
    expect(JsonPatchOperationSchema.safeParse({ op: 'replace', path: '', value: {} }).success)
      .toBe(false);
  });

  it('rejects patch operations the project format does not support', () => {
    expect(
      JsonPatchOperationSchema.safeParse({ op: 'move', from: '/a', path: '/b' }).success,
    ).toBe(false);
  });

  it('rejects a non JSON value inside an add operation', () => {
    expect(
      JsonPatchOperationSchema.safeParse({ op: 'add', path: '/a', value: () => 1 }).success,
    ).toBe(false);
  });
});

describe('AgentOperationSchema', () => {
  it('accepts a proposed editing operation', () => {
    expect(AgentOperationSchema.safeParse(operation()).success).toBe(true);
  });

  it('rejects an unknown agent role', () => {
    expect(AgentOperationSchema.safeParse(operation({ role: 'publisher' })).success).toBe(false);
  });

  it('accepts every production role named by the specification', () => {
    for (const role of [
      'planner',
      'researcher',
      'scriptwriter',
      'asset-scout',
      'editor',
      'motion-designer',
      'audio-subtitle',
      'qa-reviewer',
      'coordinator',
    ]) {
      expect(AgentOperationSchema.safeParse(operation({ role })).success).toBe(true);
    }
  });

  it('rejects an operation that changes nothing', () => {
    expect(AgentOperationSchema.safeParse(operation({ patch: [] })).success).toBe(false);
  });

  it('rejects an operation whose patch is malformed', () => {
    expect(
      AgentOperationSchema.safeParse(operation({ patch: [{ op: 'add', path: 'no-slash' }] }))
        .success,
    ).toBe(false);
  });

  it('rejects an applied operation whose cost was never disclosed', () => {
    expect(
      AgentOperationSchema.safeParse(
        operation({
          appliedStatus: 'applied',
          cost: { items: [{ kind: 'tokens', amount: 1200, unitLabel: 'tokens' }], disclosed: false, approved: true },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects an applied paid operation the user never approved', () => {
    expect(
      AgentOperationSchema.safeParse(
        operation({
          appliedStatus: 'applied',
          cost: { items: [{ kind: 'tokens', amount: 1200, unitLabel: 'tokens' }], disclosed: true, approved: false },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts an applied paid operation that was disclosed and approved', () => {
    expect(
      AgentOperationSchema.safeParse(
        operation({
          appliedStatus: 'applied',
          cost: {
            items: [
              { kind: 'tokens', amount: 1200, unitLabel: 'tokens', estimatedUsdCents: 4 },
            ],
            disclosed: true,
            approved: true,
          },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a provider reference without a model', () => {
    expect(AgentOperationSchema.safeParse(operation({ provider: { id: 'openai' } })).success)
      .toBe(false);
  });

  it('rejects a negative expected revision', () => {
    expect(AgentOperationSchema.safeParse(operation({ expectedRevision: -1 })).success).toBe(false);
  });

  it('rejects an unknown operation key', () => {
    expect(AgentOperationSchema.safeParse(operation({ command: 'del /q *' })).success).toBe(false);
  });

  it('accepts a reverted operation', () => {
    expect(AgentOperationSchema.safeParse(operation({ appliedStatus: 'reverted' })).success).toBe(
      true,
    );
  });
});

describe('ProvenanceRecordSchema', () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      sources: [source()],
      claims: [claim()],
      operations: [operation()],
      ...overrides,
    };
  }

  it('accepts a record with a source, a claim and a proposed operation', () => {
    expect(ProvenanceRecordSchema.safeParse(record()).success).toBe(true);
  });

  it('rejects a claim that cites a source that is not recorded', () => {
    expect(
      ProvenanceRecordSchema.safeParse(
        record({ claims: [claim({ status: 'verified', sourceIds: [SCENE] })] }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate source ids', () => {
    expect(ProvenanceRecordSchema.safeParse(record({ sources: [source(), source()] })).success).toBe(
      false,
    );
  });

  it('rejects duplicate operation ids', () => {
    expect(
      ProvenanceRecordSchema.safeParse(record({ operations: [operation(), operation()] })).success,
    ).toBe(false);
  });

  it('rejects an unknown record key', () => {
    expect(ProvenanceRecordSchema.safeParse(record({ secrets: {} })).success).toBe(false);
  });
});
