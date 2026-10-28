// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { DownloadProbe, DownloadRequest } from '../../services/project-service';
import {
  clampParallel,
  historyFromJob,
  loadHistory,
  loadMaxParallel,
  loadQueue,
  makeJob,
  nextRepeatTime,
  nextWindowOpen,
  parseProxyPool,
  pickProxy,
  saveHistory,
  saveMaxParallel,
  saveQueue,
  windowAllows,
} from './queue';
const probe: DownloadProbe = {
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'Video de prueba',
  uploader: 'Canal',
  durationSeconds: 30,
  thumbnail: 'https://img.example/thumb.jpg',
  kind: 'video',
  entryCount: 1,
  maxHeight: 1080,
  estimatedBytes: 20_000_000,
  qualities: [],
};

const request: DownloadRequest = {
  url: probe.url,
  compression: 'none',
  codec: 'h265',
  kind: 'video',
  format: 'mp4',
  saveToDownloads: true,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('cola persistente del descargador', () => {
  it('crea un job con runId estable y lo recupera del localStorage', () => {
    const job = makeJob({ probe, request, denoise: false });
    expect(job.request.runId).toBe(job.runId);
    expect(job.status).toBe('pending');
    saveQueue([job]);
    const loaded = loadQueue();
    expect(loaded).toHaveLength(1);
    const first = loaded[0]!;
    expect(first.runId).toBe(job.runId);
    expect(first.request.runId).toBe(job.runId);
  });

  it('al reabrir, un trabajo que estaba corriendo se reencola solo', () => {
    const job = makeJob({ probe, request, denoise: true });
    saveQueue([{ ...job, status: 'running' }]);
    const loaded = loadQueue();
    const first = loaded[0]!;
    expect(first.status).toBe('pending');
    expect(first.denoise).toBe(true);
  });

  it('conserva la hora programada al reabrir la app', () => {
    const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
    const job = makeJob({ probe, request, denoise: false, scheduledFor });
    saveQueue([job]);
    const loaded = loadQueue();
    expect(loaded[0]!.scheduledFor).toBe(scheduledFor);
    expect(loaded[0]!.status).toBe('pending');
    const immediate = makeJob({ probe, request, denoise: false });
    expect(immediate.scheduledFor).toBeNull();
  });

  it('rota la lista de proxies trabajo a trabajo', () => {
    const pool = parseProxyPool(
      ' socks5://127.0.0.1:1080 \n\nhttp://127.0.0.1:8080\n  \n',
    );
    expect(pool).toEqual(['socks5://127.0.0.1:1080', 'http://127.0.0.1:8080']);
    expect(pickProxy(pool, 0)).toBe('socks5://127.0.0.1:1080');
    expect(pickProxy(pool, 1)).toBe('http://127.0.0.1:8080');
    expect(pickProxy(pool, 2)).toBe('socks5://127.0.0.1:1080');
    expect(pickProxy([], 3)).toBeNull();
  });

  it('limita la concurrencia elegida entre 1 y 512', () => {
    saveMaxParallel(9999);
    expect(loadMaxParallel()).toBe(512);
    saveMaxParallel(0);
    expect(loadMaxParallel()).toBe(1);
    saveMaxParallel(5);
    expect(loadMaxParallel()).toBe(5);
  });

  it('usa 6 por defecto y reserva 512 para el modo avanzado', () => {
    window.localStorage.clear();
    expect(loadMaxParallel()).toBe(6);
    expect(clampParallel(512, false)).toBe(8);
    expect(clampParallel(512, true)).toBe(512);
    expect(clampParallel(9999, true)).toBe(512);
    expect(clampParallel(4, false)).toBe(4);
  });

  it('respeta ventanas horarias que cruzan la medianoche', () => {
    const at = (hours: number, minutes: number) => new Date(2026, 9, 28, hours, minutes).getTime();
    expect(windowAllows('09:00', '18:00', at(10, 0))).toBe(true);
    expect(windowAllows('09:00', '18:00', at(20, 0))).toBe(false);
    expect(windowAllows('22:00', '06:00', at(23, 30))).toBe(true);
    expect(windowAllows('22:00', '06:00', at(5, 0))).toBe(true);
    expect(windowAllows('22:00', '06:00', at(12, 0))).toBe(false);
    expect(nextWindowOpen('09:00', '18:00', at(20, 0))).toBe(at(9, 0) + 86_400_000);
    const monday = new Date(2026, 9, 26, 10, 0).getTime();
    const tuesday = new Date(2026, 9, 27, 10, 0).getTime();
    expect(windowAllows('00:00', '23:59', monday, [1])).toBe(true);
    expect(windowAllows('00:00', '23:59', tuesday, [1])).toBe(false);
    expect(windowAllows('00:00', '23:59', tuesday, [])).toBe(true);
  });

  it('calcula la siguiente repetición sin quedar en el pasado', () => {
    const now = 1_800_000_000_000;
    expect(nextRepeatTime('none', now, now)).toBeNull();
    expect(nextRepeatTime('hourly', now, now)).toBe(now + 3_600_000);
    expect(nextRepeatTime('daily', now - 200_000_000, now)).toBe(now + 59_200_000);
  });

  it('el historial guarda la solicitud y los archivos para reintentar', () => {
    const job = makeJob({ probe, request, denoise: false });
    const entry = historyFromJob(
      {
        ...job,
        outcome: {
          runId: job.runId,
          directory: 'D:\\Videos',
          files: [
            {
              path: 'D:\\Videos\\video.mp4',
              name: 'video.mp4',
              bytes: 1234,
              kind: 'video',
              chapters: [{ startSeconds: 5, title: 'Capítulo' }],
            },
          ],
          compressed: false,
          warnings: ['aviso'],
          subtitles: [
            {
              path: 'D:\\Videos\\video.es.srt',
              name: 'video.es.srt',
              text: '1\n00:00:00,000 --> 00:00:01,000\nHola\n',
            },
          ],
        },
      },
      'done',
      null,
    );
    saveHistory([entry]);
    const loaded = loadHistory();
    const first = loaded[0]!;
    expect(first.request.url).toBe(probe.url);
    expect(first.files[0]!.path).toBe('D:\\Videos\\video.mp4');
    expect(first.status).toBe('done');
  });
});
