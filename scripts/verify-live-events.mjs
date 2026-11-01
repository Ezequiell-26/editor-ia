#!/usr/bin/env node
// Verifica SSE (/v1/mcp/events), replay con Last-Event-ID y auditoría persistente.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));
const projectPath = argument(
  '--project',
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-integral', 'integral.editoria.json'),
);
const base = `http://127.0.0.1:${port}`;
const withRender = process.argv.includes('--render');

async function call(tool, args = {}) {
  const response = await fetch(`${base}/v1/mcp/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-editoria-token': token },
    body: JSON.stringify({ tool, arguments: args }),
  });
  return response.json();
}

async function openStream(lastEventId) {
  const controller = new AbortController();
  const response = await fetch(`${base}/v1/mcp/events`, {
    headers: {
      'x-editoria-token': token,
      ...(lastEventId ? { 'last-event-id': String(lastEventId) } : {}),
    },
    signal: controller.signal,
  });
  if (response.status !== 200) throw new Error(`SSE respondió ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  let reading = true;
  const task = (async () => {
    try {
      while (reading) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let id = 0;
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('id: ')) id = Number(line.slice(4));
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (data) events.push({ id, ...JSON.parse(data) });
        }
      }
    } catch {
      // abort esperado
    }
  })();
  return {
    events,
    async close() {
      reading = false;
      controller.abort();
      await task;
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const first = await openStream();
await wait(300);
const opened = await call('project_open', { path: projectPath });
const inspected = await call('project_inspect');
await wait(500);
await first.close();
if (opened.ok !== true || inspected.ok !== true) {
  throw new Error(`tool calls fallaron: ${JSON.stringify({ opened, inspected }).slice(0, 400)}`);
}
const finished = first.events.filter((event) => event.type === 'tool_finished');
const names = finished.map((event) => event.tool);
if (!names.includes('project_open') || !names.includes('project_inspect')) {
  throw new Error(`faltan eventos: ${JSON.stringify(finished)}`);
}
const lastId = Math.max(...first.events.map((event) => event.id));
if (!Number.isFinite(lastId) || lastId < 1) {
  throw new Error(`los eventos no traen id: ${JSON.stringify(first.events)}`);
}

// Mientras no hay stream, se pierde un pedido; al reconectar con Last-Event-ID
// el servidor debe reenviarlo desde el historial corto.
const catalog = await call('engine_catalog');
if (catalog.ok !== true) throw new Error(`engine_catalog falló: ${catalog.summary}`);
const second = await openStream(lastId);
await wait(600);
await second.close();
const replayed = second.events.filter(
  (event) => event.type === 'tool_finished' && event.tool === 'engine_catalog',
);
if (replayed.length !== 1) {
  throw new Error(`replay incompleto: ${JSON.stringify(second.events)}`);
}
const replayedIds = second.events.map((event) => event.id);
if (replayedIds.some((id) => id <= lastId)) {
  throw new Error(`el replay repitió eventos viejos: ${JSON.stringify(replayedIds)}`);
}

let renderEvents = null;
if (withRender) {
  const third = await openStream();
  const started = await call('render_start');
  if (started.ok !== true) throw new Error(`render_start falló: ${started.summary}`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(1000);
    if (third.events.some((event) => event.type === 'render_finished')) break;
  }
  await third.close();
  const progress = third.events.filter((event) => event.type === 'render_progress');
  const finishedRender = third.events.find((event) => event.type === 'render_finished');
  if (progress.length === 0 || !finishedRender) {
    throw new Error(
      `no llegaron eventos de render: ${JSON.stringify(third.events.slice(0, 6))}`,
    );
  }
  renderEvents = {
    progress: progress.length,
    lastProgress: progress.at(-1)?.progress ?? null,
    finished: finishedRender.finished ?? null,
  };
}

const auditResponse = await fetch(`${base}/v1/mcp/audit?limit=10`, {
  headers: { 'x-editoria-token': token },
});
const audit = await auditResponse.json();
if (audit.ok !== true || !Array.isArray(audit.entries)) {
  throw new Error(`auditoría inválida: ${JSON.stringify(audit).slice(0, 300)}`);
}
const auditedTools = audit.entries.map((entry) => entry.tool);
if (
  !auditedTools.includes('project_open') ||
  !auditedTools.includes('project_inspect') ||
  !auditedTools.includes('engine_catalog')
) {
  throw new Error(`la auditoría no registró los pedidos: ${JSON.stringify(auditedTools)}`);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      firstStream: first.events.length,
      lastId,
      finished: finished.map((event) => ({
        tool: event.tool,
        ok: event.ok,
        durationMs: event.durationMs,
      })),
      replayed: replayed.map((event) => ({
        id: event.id,
        tool: event.tool,
        durationMs: event.durationMs,
      })),
      ...(renderEvents ? { renderEvents } : {}),
      auditEntries: audit.entries.length,
      auditedTools,
      lastAudit: audit.entries.at(-1),
    },
    null,
    2,
  ),
);
