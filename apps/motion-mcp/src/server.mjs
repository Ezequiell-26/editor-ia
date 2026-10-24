#!/usr/bin/env node
// Minimal MCP stdio server for Editor IA motion plans.
// It implements initialize, tools/list and tools/call, the subset the editor's
// MCP manager uses. Rendering stays in Editor IA; this server only creates and
// validates neutral plans.

import { createInterface } from 'node:readline';
import { buildPlan, listTemplates, validatePlan, VERSION } from './catalog.mjs';

const SERVER = { name: 'editor-ia-motion', version: VERSION };
const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'motion_list_templates',
    description: 'Lista las plantillas de motion graphics incluidas con sus props.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'motion_create',
    description:
      'Crea un MotionPlan neutral para una plantilla. No renderiza: Editor IA valida, previsualiza y renderiza.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          enum: ['title-card', 'lower-third', 'end-card', 'stat-callout'],
        },
        props: { type: 'object' },
        width: { type: 'number' },
        height: { type: 'number' },
        fps: { type: 'number' },
        durationFrames: { type: 'number' },
      },
      required: ['templateId'],
      additionalProperties: false,
    },
  },
  {
    name: 'motion_validate',
    description: 'Valida la estructura y los límites de un MotionPlan.',
    inputSchema: {
      type: 'object',
      properties: { plan: { type: 'object' } },
      required: ['plan'],
      additionalProperties: false,
    },
  },
];

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function textResult(value, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function callTool(name, args) {
  if (name === 'motion_list_templates') {
    return textResult({ ok: true, templates: listTemplates() });
  }
  if (name === 'motion_create') {
    try {
      if (!args || typeof args !== 'object') throw new Error('arguments debe ser un objeto');
      const plan = buildPlan(args.templateId, args.props, {
        width: args.width,
        height: args.height,
        fps: args.fps,
        durationFrames: args.durationFrames,
      });
      const errors = validatePlan(plan);
      if (errors.length > 0) throw new Error(errors.join('; '));
      return textResult({ ok: true, plan });
    } catch (error) {
      return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
    }
  }
  if (name === 'motion_validate') {
    const errors = validatePlan(args?.plan);
    return textResult({ ok: errors.length === 0, errors });
  }
  return textResult({ ok: false, error: `herramienta ${name} desconocida` }, true);
}

function handle(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = message;
  const isNotification = id === undefined;
  if (method === 'notifications/initialized') return null;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      },
    };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    if (!params || typeof params.name !== 'string') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'tools/call requiere name' },
      };
    }
    return { jsonrpc: '2.0', id, result: callTool(params.name, params.arguments ?? {}) };
  }
  if (isNotification) return null;
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  let response;
  try {
    response = handle(message);
  } catch (error) {
    response = {
      jsonrpc: '2.0',
      id: message?.id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    };
  }
  if (response !== null) send(response);
});
