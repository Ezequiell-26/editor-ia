import test from 'node:test';
import assert from 'node:assert/strict';

import { QueueEngine } from '../src/lib/queue.js';

function itemStatus(engine) {
  return engine.state().items.map((item) => item.status);
}

test('runs every prompt in order and records the results', async () => {
  const calls = [];
  const engine = new QueueEngine({
    prompts: ['uno', 'dos', 'tres'],
    delayMs: 0,
    runPrompt: async (prompt, index) => {
      calls.push([prompt, index]);
      return { ok: true };
    },
  });

  const final = await engine.start();

  assert.deepEqual(calls, [
    ['uno', 0],
    ['dos', 1],
    ['tres', 2],
  ]);
  assert.equal(final.status, 'completed');
  assert.equal(final.completedCount, 3);
  assert.deepEqual(itemStatus(engine), ['done', 'done', 'done']);
});

test('pauses between prompts and resumes without losing the cursor', async () => {
  const calls = [];
  let releaseFirst;
  const firstPrompt = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const engine = new QueueEngine({
    prompts: ['uno', 'dos'],
    delayMs: 0,
    runPrompt: async (prompt) => {
      calls.push(prompt);
      if (prompt === 'uno') await firstPrompt;
      return { ok: true };
    },
  });

  const running = engine.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.pause();
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(engine.state().status, 'paused');
  assert.deepEqual(calls, ['uno']);
  assert.deepEqual(itemStatus(engine), ['done', 'pending']);

  engine.resume();
  const final = await running;

  assert.deepEqual(calls, ['uno', 'dos']);
  assert.equal(final.status, 'completed');
});

test('stops on the first failure by default', async () => {
  const calls = [];
  const engine = new QueueEngine({
    prompts: ['uno', 'dos', 'tres'],
    delayMs: 0,
    runPrompt: async (prompt) => {
      calls.push(prompt);
      if (prompt === 'dos') throw new Error('Flow no devolvió imagen');
      return { ok: true };
    },
  });

  const final = await engine.start();

  assert.deepEqual(calls, ['uno', 'dos']);
  assert.equal(final.status, 'failed');
  assert.equal(final.completedCount, 1);
  assert.equal(final.failedCount, 1);
  assert.match(final.error, /no devolvió imagen/);
  assert.deepEqual(itemStatus(engine), ['done', 'error', 'pending']);
});

test('can continue after a failure when explicitly requested', async () => {
  const calls = [];
  const engine = new QueueEngine({
    prompts: ['uno', 'dos', 'tres'],
    delayMs: 0,
    continueOnError: true,
    runPrompt: async (prompt) => {
      calls.push(prompt);
      if (prompt === 'dos') throw new Error('falló');
      return { ok: true };
    },
  });

  const final = await engine.start();

  assert.deepEqual(calls, ['uno', 'dos', 'tres']);
  assert.equal(final.status, 'completed-with-errors');
  assert.equal(final.completedCount, 2);
  assert.equal(final.failedCount, 1);
  assert.deepEqual(itemStatus(engine), ['done', 'error', 'done']);
});

test('stop aborts the prompt in flight and marks the queue stopped', async () => {
  const engine = new QueueEngine({
    prompts: ['uno', 'dos'],
    delayMs: 0,
    runPrompt: async (_prompt, _index, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true });
      }),
  });

  const running = engine.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.stop();
  const final = await running;

  assert.equal(final.status, 'stopped');
  assert.equal(final.failedCount, 0);
  assert.deepEqual(itemStatus(engine), ['error', 'pending']);
});

test('refuses to start twice and rejects an empty queue', async () => {
  const engine = new QueueEngine({
    prompts: [],
    runPrompt: async () => ({ ok: true }),
  });
  await assert.rejects(() => engine.start(), /no hay prompts/i);

  const busy = new QueueEngine({
    prompts: ['uno'],
    runPrompt: async () => new Promise(() => {}),
  });
  void busy.start();
  await assert.rejects(() => busy.start(), /ya está corriendo/i);
  busy.stop();
});

test('applies the requested pace between prompts', async () => {
  const waits = [];
  const engine = new QueueEngine({
    prompts: ['uno', 'dos'],
    delayMs: 2500,
    runPrompt: async () => ({ ok: true }),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  await engine.start();

  assert.deepEqual(waits, [2500, 2500]);
});
