import { describe, expect, it } from 'vitest';
import { buildFlowArgs, flowFailure } from './flow';

const FLOW_MCP_SCHEMA = {
  type: 'object',
  properties: {
    accountId: { type: 'string' },
    prompt: { type: 'string' },
    flowProject: { type: 'string' },
    model: { type: 'string' },
    aspectRatio: { type: 'string' },
    durationSeconds: { type: 'number' },
    outputs: { type: 'number' },
    upscale: { type: 'string' },
    outputDirectory: { type: 'string' },
    fileName: { type: 'string' },
    download: { type: 'boolean' },
    timeoutSeconds: { type: 'number' },
    confirmCreditSpend: { type: 'boolean' },
  },
};

const LEGACY_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    model: { type: 'string' },
    ratio: { type: 'string' },
    duration: { type: 'string' },
    auto_confirm: { type: 'boolean' },
    output_folder: { type: 'string' },
    response_format: { type: 'string' },
  },
};

describe('buildFlowArgs', () => {
  it('habla el dialecto de google-flow-mcp (miyakejima)', () => {
    const args = buildFlowArgs({
      prompt: 'Un faro al atardecer',
      kind: 'video',
      outputDir: 'C:\\media',
      model: 'veo-3-1-fast',
      ratio: '9:16',
      duration: '8s',
      credits: true,
      schema: FLOW_MCP_SCHEMA,
    });
    expect(args).toEqual({
      prompt: 'Un faro al atardecer',
      model: 'veo-3-1-fast',
      aspectRatio: '9:16',
      durationSeconds: 8,
      outputs: 1,
      outputDirectory: 'C:\\media',
      confirmCreditSpend: true,
    });
    expect(args).not.toHaveProperty('ratio');
    expect(args).not.toHaveProperty('auto_confirm');
    expect(args).not.toHaveProperty('output_folder');
  });

  it('habla el dialecto anterior sin perder compatibilidad', () => {
    const args = buildFlowArgs({
      prompt: 'Un faro',
      kind: 'image',
      outputDir: 'C:\\media',
      model: 'nano-banana-2',
      ratio: '16:9',
      credits: true,
      schema: LEGACY_SCHEMA,
    });
    expect(args).toEqual({
      prompt: 'Un faro',
      model: 'nano-banana-2',
      ratio: '16:9',
      output_folder: 'C:\\media',
      auto_confirm: true,
      response_format: 'detailed',
    });
  });

  it('sin schema manda el superconjunto', () => {
    const args = buildFlowArgs({
      prompt: 'Un faro',
      kind: 'video',
      outputDir: 'C:\\media',
      ratio: '1:1',
      duration: '6s',
    });
    expect(args.aspectRatio).toBe('1:1');
    expect(args.ratio).toBe('1:1');
    expect(args.outputDirectory).toBe('C:\\media');
    expect(args.output_folder).toBe('C:\\media');
    expect(args.confirmCreditSpend).toBe(true);
    expect(args.auto_confirm).toBe(true);
    expect(args.durationSeconds).toBe(6);
    expect(args.duration).toBe('6s');
  });

  it('manda accountId cuando el schema lo declara', () => {
    const args = buildFlowArgs({
      prompt: 'Un faro',
      kind: 'image',
      outputDir: 'C:////media',
      accountId: 'cuenta-2',
      schema: FLOW_MCP_SCHEMA,
    });
    expect(args.accountId).toBe('cuenta-2');
  });

  it('extrae código y mensaje de un fallo', () => {
    expect(
      flowFailure({ content: [{ type: 'text', text: JSON.stringify({ error: { code: 'insufficient_credits', message: 'sin créditos' } }) }] }),
    ).toEqual({ code: 'insufficient_credits', message: 'sin créditos' });
    expect(flowFailure({ content: [{ type: 'text', text: 'texto suelto' }] })).toEqual({
      code: null,
      message: 'texto suelto',
    });
    expect(flowFailure(null)).toEqual({ code: null, message: 'Flow devolvió un error' });
  });

  it('sin créditos no manda ninguna de las dos banderas', () => {
    const args = buildFlowArgs({
      prompt: 'Un faro',
      kind: 'image',
      outputDir: 'C:\\media',
      credits: false,
    });
    expect(args).not.toHaveProperty('confirmCreditSpend');
    expect(args).not.toHaveProperty('auto_confirm');
  });
});
