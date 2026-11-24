// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { Asset } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import type { ProjectStoreValue } from '../../state/project-store-types';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { hideMediaSpy, pinMediaSpy, scrubMediaSpy } from '../../state/media-spy';
import { MediaSpyOverlay } from './MediaSpyOverlay';

const NOW = '2026-10-20T00:00:00.000Z';

afterEach(() => {
  cleanup();
  hideMediaSpy();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

let storeRef: ProjectStoreValue | null = null;

function Probe(): null {
  storeRef = useProjectStore();
  return null;
}

function renderOverlay(asset: Asset, extraProject?: (p: ReturnType<typeof addAsset>) => ReturnType<typeof addAsset>) {
  const base = ensureDelivery(createEmptyProject('Spy', NOW));
  let project = addAsset(base, asset);
  if (extraProject) project = extraProject(project);
  render(
    <ProjectProvider
      service={createFakeService()}
      initial={{
        project,
        opened: {
          project,
          label: 'spy.editoria.json',
          path: 'C:\\tester\\spy.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <Probe />
      <MediaSpyOverlay />
    </ProjectProvider>,
  );
}

function clips() {
  return storeRef?.state.project?.timeline.clips ?? [];
}

function markButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.media-spy-mark'));
}

describe('MediaSpyOverlay — source monitor in/out', () => {
  it('imagen fijada inserta el still completo', () => {
    const asset = readyAsset({
      kind: 'image',
      media: { width: 1920, height: 1080 },
    } as Partial<Asset>);
    pinMediaSpy(asset.id, '/media/foto.png', 'image', 0, 0);
    renderOverlay(asset);
    const insert = document.querySelector<HTMLButtonElement>('.media-spy-insert');
    expect(insert).not.toBeNull();
    fireEvent.click(insert!);
    const all = clips();
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe('image');
    // El pin queda para poder insertar el still otra vez (Escape suelta).
    expect(document.querySelector('.media-spy-pin')).not.toBeNull();
  });

  it('imagen fijada no muestra marcas I/O pero sí Insertar', () => {
    const asset = readyAsset({
      kind: 'image',
      media: { width: 1920, height: 1080 },
    } as Partial<Asset>);
    pinMediaSpy(asset.id, '/media/foto.png', 'image', 0, 0);
    renderOverlay(asset);
    expect(document.querySelector('.media-spy-pin')).not.toBeNull();
    expect(document.querySelector('.media-spy-mark')).toBeNull();
    expect(document.querySelector('.media-spy-loop')).toBeNull();
    expect(document.querySelector('.media-spy-insert')).not.toBeNull();
  });

  it('sin pin no hay overlay', () => {
    const asset = readyAsset();
    renderOverlay(asset);
    expect(document.querySelector('.media-spy')).toBeNull();
  });

  it('marca I/O e inserta sólo el rango en el playhead', () => {
    const asset = readyAsset(); // 300 frames @30fps = 10s
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    const insert = document.querySelector<HTMLButtonElement>('.media-spy-insert');
    expect(insert).not.toBeNull();
    expect(markButtons()).toHaveLength(2);
    // Sin marcas, Insertar está deshabilitado.
    expect(insert!.disabled).toBe(true);
    // I en t=0.
    fireEvent.click(markButtons()[0]!);
    // O en t=4s → 120 frames a 30fps.
    act(() => scrubMediaSpy(asset.id, 4));
    fireEvent.click(markButtons()[1]!);
    const insertBtn = document.querySelector<HTMLButtonElement>('.media-spy-insert')!;
    expect(insertBtn.disabled).toBe(false);
    fireEvent.click(insertBtn);
    const all = clips();
    expect(all).toHaveLength(1);
    const source = all[0]!.source;
    expect(source).toMatchObject({ type: 'asset', assetId: asset.id });
    if (source.type === 'asset' && 'inFrame' in source) {
      expect(source.inFrame).toBe(0);
      expect(source.outFrame).toBe(120);
    }
    // Al insertar el pin QUEDA (source monitor: encadenar rangos) y las
    // marcas se limpian para el siguiente rango.
    expect(document.querySelector('.media-spy-pin')).not.toBeNull();
    expect(document.querySelector('.media-spy-range')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.media-spy-insert')!.disabled,
    ).toBe(true);
  });

  it('encadena dos rangos del mismo medio sin re-pinear', () => {
    const asset = readyAsset(); // 10s @30fps
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    // Primer rango: 0–2s (60 frames).
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 2));
    fireEvent.click(markButtons()[1]!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.media-spy-insert')!);
    expect(clips()).toHaveLength(1);
    // El pin sigue: segundo rango 4–6s se marca y añade otro clip.
    act(() => scrubMediaSpy(asset.id, 4));
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 6));
    fireEvent.click(markButtons()[1]!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.media-spy-insert')!);
    const all = clips();
    expect(all).toHaveLength(2);
    const second = all[1]!.source;
    if (second.type === 'asset' && 'inFrame' in second) {
      expect(second.inFrame).toBe(120);
      expect(second.outFrame).toBe(180);
    }
  });

  it('sólo salida marcada inserta desde el inicio', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 2);
    renderOverlay(asset);
    // shownTime = 2s → O marca 2s = 60 frames; sin I, in = 0.
    fireEvent.click(markButtons()[1]!);
    const insertBtn = document.querySelector<HTMLButtonElement>('.media-spy-insert')!;
    fireEvent.click(insertBtn);
    const all = clips();
    expect(all).toHaveLength(1);
    const source = all[0]!.source;
    if (source.type === 'asset' && 'inFrame' in source) {
      expect(source.inFrame).toBe(0);
      expect(source.outFrame).toBe(60);
    }
  });

  it('teclas I/O marcan el rango igual que los botones', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    });
    act(() => scrubMediaSpy(asset.id, 4));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    });
    const insertBtn = document.querySelector<HTMLButtonElement>('.media-spy-insert')!;
    fireEvent.click(insertBtn);
    const all = clips();
    expect(all).toHaveLength(1);
    const source = all[0]!.source;
    if (source.type === 'asset' && 'inFrame' in source) {
      expect(source.inFrame).toBe(0);
      expect(source.outFrame).toBe(120);
    }
  });

  it('teclas con modificador no marcan el rango del source', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true }),
      );
    });
    expect(document.querySelector('.media-spy-range')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.media-spy-insert')!.disabled,
    ).toBe(true);
  });

  it('Shift+. adelanta el source 1 segundo (timecode visible)', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    // jsdom no implementa currentTime de medios: la prueba observable es
    // el timecode vivo, que stepSourceMedia actualiza vía setLiveTime.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '>', shiftKey: true }),
      );
    });
    expect(document.querySelector('.media-spy-time')!.textContent).toBe('00:01');
  });

  it('teclas I/O no marcan dentro de un input', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    input.remove();
    expect(document.querySelector('.media-spy-range')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.media-spy-insert')!.disabled,
    ).toBe(true);
  });

  it('el selector de pista manda el clip a la pista elegida', () => {
    const asset = readyAsset();
    let v2 = '';
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset, (p) => {
      const t = addTrack(p, 'video', 'V2');
      v2 = t.trackId;
      return t.project;
    });
    const select = document.querySelector<HTMLSelectElement>('.media-spy-track');
    expect(select).not.toBeNull();
    fireEvent.change(select!, { target: { value: v2 } });
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 2));
    fireEvent.click(markButtons()[1]!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.media-spy-insert')!);
    const all = clips();
    expect(all).toHaveLength(1);
    expect(all[0]!.trackId).toBe(v2);
  });

  it('Loop se habilita con marcas y alterna su estado', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    const loopBtn = document.querySelector<HTMLButtonElement>('.media-spy-loop')!;
    expect(loopBtn).toBeTruthy();
    expect(loopBtn.disabled).toBe(true);
    // Sólo entrada: el loop no tiene límite, sigue deshabilitado.
    fireEvent.click(markButtons()[0]!);
    expect(loopBtn.disabled).toBe(true);
    // Con salida marcada se habilita.
    act(() => scrubMediaSpy(asset.id, 4));
    fireEvent.click(markButtons()[1]!);
    expect(loopBtn.disabled).toBe(false);
    fireEvent.click(loopBtn);
    expect(loopBtn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(loopBtn);
    expect(loopBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('el botón ✕ limpia las marcas', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    fireEvent.click(markButtons()[0]!);
    const clear = document.querySelectorAll<HTMLButtonElement>('.media-spy-mark')[2]!;
    fireEvent.click(clear);
    expect(document.querySelector('.media-spy-range')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.media-spy-insert')!.disabled,
    ).toBe(true);
  });

  it('sin metadata de video no dibuja la regla de marcas', () => {
    // jsdom reporta videoWidth=0 → contentBox null → sin ticks (letterbox-safe).
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 4));
    fireEvent.click(markButtons()[1]!);
    expect(document.querySelector('.media-spy-ruler')).toBeNull();
  });

  it('audio fijado muestra controles y su rango cae en pista audio', () => {
    const asset = readyAsset({
      kind: 'audio',
      source: { type: 'local', path: 'media/voz.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 150 },
    } as Partial<Asset>);
    // 150 frames a 30fps del proyecto = 5s.
    pinMediaSpy(asset.id, '/media/voz.wav', 'audio', 5, 0);
    renderOverlay(asset);
    const audio = document.querySelector<HTMLAudioElement>('audio.media-spy-audio');
    expect(audio).not.toBeNull();
    expect(audio!.hasAttribute('controls')).toBe(true);
    expect(document.querySelector('.media-spy-pin')).not.toBeNull();
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 2));
    fireEvent.click(markButtons()[1]!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.media-spy-insert')!);
    const all = clips();
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe('audio');
    const track = storeRef?.state.project?.timeline.tracks.find(
      (item) => item.id === all[0]!.trackId,
    );
    expect(['audio', 'narration']).toContain(track?.kind);
    const source = all[0]!.source;
    if (source.type === 'asset' && 'inFrame' in source) {
      expect(source.inFrame).toBe(0);
      expect(source.outFrame).toBe(60);
    }
  });

  it('＋Fin inserta el rango al final, no en el primer gap del playhead', () => {
    const asset = readyAsset(); // 300 frames @30fps
    // Proyecto con clips en 0–60 y 200–260: el playhead (0) tiene un gap
    // en 60, pero "al final" debe caer en 260.
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset, (p) => {
      const a = addClipFromAsset(p, asset, {
        atFrame: 0,
        durationFrames: 60,
      });
      const b = addClipFromAsset(a.project, asset, {
        atFrame: 200,
        durationFrames: 60,
      });
      return b.project;
    });
    expect(clips()).toHaveLength(2);
    // Rango marcado 0–1s = 30 frames.
    fireEvent.click(markButtons()[0]!);
    act(() => scrubMediaSpy(asset.id, 1));
    fireEvent.click(markButtons()[1]!);
    const inserts = document.querySelectorAll<HTMLButtonElement>('.media-spy-insert');
    expect(inserts).toHaveLength(2);
    fireEvent.click(inserts[1]!); // ＋Fin
    const all = clips();
    expect(all).toHaveLength(3);
    const appended = all.find((clip) => clip.startFrame === 260);
    expect(appended).toBeTruthy();
    // Y el insert de playhead sigue yendo al primer gap (60): nuevo
    // rango 0–1s marcando I en 0 y O en 1 (marcas degeneradas ya no
    // insertan — AUD-152).
    act(() => scrubMediaSpy(asset.id, 0));
    fireEvent.click(markButtons()[0]!); // I en 0
    act(() => scrubMediaSpy(asset.id, 1));
    fireEvent.click(markButtons()[1]!); // O en 1
    fireEvent.click(
      document.querySelectorAll<HTMLButtonElement>('.media-spy-insert')[0]!,
    );
    expect(clips()).toHaveLength(4);
    expect(clips().some((clip) => clip.startFrame === 60)).toBe(true);
  });

  it('marcar I después de O nunca invierte el rango (AUD-152)', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    // O en 2s, luego I en 4s → in se clampa a out: rango degenerado.
    act(() => scrubMediaSpy(asset.id, 2));
    fireEvent.click(markButtons()[1]!); // O
    act(() => scrubMediaSpy(asset.id, 4));
    fireEvent.click(markButtons()[0]!); // I
    const range = document.querySelector('.media-spy-range')!;
    expect(range.classList.contains('media-spy-range-invalid')).toBe(true);
    expect(range.textContent).toBe('00:02–00:02');
    // Insertar y Loop quedan deshabilitados con rango vacío.
    for (const btn of document.querySelectorAll<HTMLButtonElement>(
      '.media-spy-insert, .media-spy-loop',
    )) {
      expect(btn.disabled).toBe(true);
    }
    // Corregir la salida (O en 6s) rehabilita el rango.
    act(() => scrubMediaSpy(asset.id, 6));
    fireEvent.click(markButtons()[1]!); // O
    expect(
      document.querySelector('.media-spy-range')!.classList.contains(
        'media-spy-range-invalid',
      ),
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('.media-spy-insert')!.disabled,
    ).toBe(false);
  });

  it('el scrub coalescido aplica un solo seek por frame (AUD-151)', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    const video = document.querySelector<HTMLVideoElement>('video.media-spy-media')!;
    let sets = 0;
    let lastVal = -1;
    Object.defineProperty(video, 'currentTime', {
      get: () => lastVal,
      set: (v: number) => {
        sets += 1;
        lastVal = v;
      },
      configurable: true,
    });
    // 10 movimientos de scrub seguidos: con el bug (flush por efecto)
    // cada uno aplicaba un seek; con el coalescer sólo queda 1 pendiente.
    act(() => {
      for (let i = 1; i <= 10; i += 1) scrubMediaSpy(asset.id, i);
    });
    expect(sets).toBe(0);
    act(() => {
      const pending = rafQueue.splice(0);
      for (const cb of pending) cb(0);
    });
    expect(sets).toBe(1);
    expect(lastVal).toBeCloseTo(10, 5);
  });

  it('material eliminado no inserta y avisa', () => {
    const asset = readyAsset();
    pinMediaSpy(asset.id, '/media/toma.mp4', 'video', 10, 0);
    renderOverlay(asset);
    fireEvent.click(markButtons()[0]!);
    // El spy apunta a un asset que no está en el proyecto.
    act(() => pinMediaSpy('fantasma', '/media/x.mp4', 'video', 10, 0));
    fireEvent.click(markButtons()[0]!);
    const insertBtn = document.querySelector<HTMLButtonElement>('.media-spy-insert')!;
    fireEvent.click(insertBtn);
    expect(clips()).toHaveLength(0);
    expect(storeRef?.state.notice).toContain('ya no está');
  });
});
