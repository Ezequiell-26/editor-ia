// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadFeeds, loadHistory, loadMaxParallel, loadQueue, loadWatchSeen,
} from './queue';

const KEYS = {
  queue: 'editor-ia.download-queue.v1',
  history: 'editor-ia.download-history.v1',
  parallel: 'editor-ia.download-parallel.v1',
  seen: 'editor-ia.download-watch-seen.v1',
  feeds: 'editor-ia.download-feeds.v1',
} as const;

beforeEach(() => window.localStorage.clear());

describe('persistencia de la cola · validación de forma', () => {
  it('devuelve una cola vacía si el valor no es un array', () => {
    window.localStorage.setItem(KEYS.queue, JSON.stringify({ status: 'done' }));
    expect(loadQueue()).toEqual([]);
  });

  it('devuelve una cola vacía si un trabajo no tiene los campos mínimos', () => {
    window.localStorage.setItem(KEYS.queue, JSON.stringify([{ id: 'j1' }]));
    expect(loadQueue()).toEqual([]);
  });

  it('conserva un trabajo válido y reencola el que estaba corriendo', () => {
    window.localStorage.setItem(KEYS.queue, JSON.stringify([{
      id: 'j1', runId: 'r1', url: 'https://example.com/v', status: 'running', request: {},
    }]));
    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('pending');
    expect(queue[0]?.runId).toBe('r1');
  });

  it('no mezcla tipos primitivos en la concurrencia', () => {
    window.localStorage.setItem(KEYS.parallel, JSON.stringify('muchos'));
    expect(loadMaxParallel()).toBe(6);
    window.localStorage.setItem(KEYS.parallel, JSON.stringify({ value: 3 }));
    expect(loadMaxParallel()).toBe(6);
  });

  it('rechaza registros de vistos con valores no numéricos', () => {
    window.localStorage.setItem(KEYS.seen, JSON.stringify({ 'a.mp4': 'ayer' }));
    expect(loadWatchSeen()).toEqual({});
    window.localStorage.setItem(KEYS.seen, JSON.stringify({ 'a.mp4': 12 }));
    expect(loadWatchSeen()).toEqual({ 'a.mp4': 12 });
  });

  it('rechaza feeds e historial con forma inválida', () => {
    window.localStorage.setItem(KEYS.feeds, JSON.stringify([{ url: 42 }]));
    expect(loadFeeds()).toEqual([]);
    window.localStorage.setItem(KEYS.history, JSON.stringify([{ id: 'h1' }]));
    expect(loadHistory()).toEqual([]);
  });

  it('tolera JSON directamente corrupto', () => {
    window.localStorage.setItem(KEYS.queue, '{no-es-json');
    expect(loadQueue()).toEqual([]);
  });
});
