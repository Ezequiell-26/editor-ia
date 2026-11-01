// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { HyperframeView } from './HyperframeView';
import type { HyperframeEntry, HyperframePreviewEntry } from './open-design';
import { renderHyperframeToVideo } from './hyperframe';

vi.mock('./hyperframe', () => ({
  fetchHyperframePreviewBase64: vi.fn(async () => 'AQID'),
  renderHyperframeToVideo: vi.fn(async () => ({
    blob: new Blob([], { type: 'video/mp4' }),
    url: 'blob:olyvia-hyperframe',
    base64: 'AAAA',
    width: 1920,
    height: 1080,
    durationSeconds: 5,
    fps: 15,
    scenes: 1,
  })),
}));

const entries: readonly HyperframeEntry[] = [
  {
    id: 'frame-bold-poster',
    title: 'Bold Poster',
    summary: 'Póster editorial en movimiento.',
    category: 'Presentation',
    tags: ['poster', 'editorial'],
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 60,
    durationSec: 15,
    license: 'Apache-2.0',
    author: 'nexu-io',
    sourceUrl: 'https://example.com/source',
    preview: 'hyperframes/frame-bold-poster/preview.png',
    html: 'hyperframes/frame-bold-poster/source/index.html',
  },
  {
    id: 'frame-logo-outro',
    title: 'Logo Outro',
    summary: 'Cierre de marca.',
    category: 'Presentation',
    tags: ['logo'],
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 60,
    durationSec: 15,
    license: 'Apache-2.0',
    author: 'nexu-io',
    sourceUrl: null,
    preview: 'hyperframes/frame-logo-outro/preview.png',
    html: 'hyperframes/frame-logo-outro/source/index.html',
  },
];

const previews: readonly HyperframePreviewEntry[] = [
  {
    id: 'frame-decision-tree',
    title: 'Decision Tree',
    summary: 'Árbol de decisión animado con GSAP.',
    category: 'Data-viz',
    tags: ['decision', 'chart'],
    aspect: '16:9',
    durationSec: 15,
    license: 'Apache-2.0',
    author: 'nexu-io',
    sourceUrl: null,
    preview: 'hyperframes/previews/frame-decision-tree/preview.png',
    video: 'hyperframes/previews/frame-decision-tree/preview.mp4',
    reason: 'scripts',
  },
];

function renderView() {
  const project = createEmptyProject('HyperFrames', '2026-10-29T00:00:00.000Z');
  const service = createFakeService();
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'hyperframes.editoria.json',
          path: 'C:\\tester\\hyperframes.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <HyperframeView entries={entries} previews={previews} onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HyperframeView', () => {
  it('lista las composiciones y muestra la preview real', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Bold Poster' })).toBeTruthy();
    expect(screen.getByTitle('Composición Bold Poster')).toBeTruthy();
    expect(screen.getByTitle('Composición Bold Poster').getAttribute('src')).toContain(
      '/open-design/hyperframes/frame-bold-poster/source/index.html',
    );
    fireEvent.click(screen.getByRole('button', { name: /Logo Outro/i }));
    expect(screen.getByRole('heading', { name: 'Logo Outro' })).toBeTruthy();
  });

  it('busca composiciones por nombre', () => {
    renderView();
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar HyperFrames/i }), {
      target: { value: 'logo' },
    });
    expect(screen.getByRole('button', { name: /Logo Outro/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bold Poster/i })).toBeNull();
  });

  it('renderiza con la duración y fps elegidos y admite guardar y montar', async () => {
    const { service, onNavigate } = renderView();
    fireEvent.click(screen.getByRole('button', { name: '5 s' }));
    fireEvent.click(screen.getByRole('button', { name: '30 fps' }));
    fireEvent.click(screen.getByRole('button', { name: /Renderizar MP4/i }));
    await waitFor(() =>
      expect(vi.mocked(renderHyperframeToVideo)).toHaveBeenCalledWith(entries[0], {
        durationSeconds: 5,
        fps: 30,
      }),
    );
    const video = await screen.findByLabelText('Video de Bold Poster');
    expect(video.getAttribute('src')).toBe('blob:olyvia-hyperframe');

    const save = vi.spyOn(service, 'saveDesignVideo');
    fireEvent.click(screen.getByRole('button', { name: /Guardar MP4/i }));
    await screen.findByText(/Guardado en/);
    expect(save).toHaveBeenCalledWith('AAAA', 'hyperframe-frame-bold-poster.mp4');

    const stage = vi.spyOn(service, 'stageDesignMedia');
    fireEvent.click(screen.getByRole('button', { name: /Enviar a Medios/i }));
    await screen.findByText(/En Medios como/);
    expect(stage).toHaveBeenCalledWith('AAAA', 'mp4');

    fireEvent.click(screen.getByRole('button', { name: /Montar en la timeline/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('muestra los previews de runtime y permite guardarlos o enviarlos', async () => {
    const { service } = renderView();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    );
    fireEvent.click(screen.getByRole('button', { name: /Solo preview/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Decision Tree/i }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Decision Tree' }),
    ).toBeTruthy();
    const video = screen.getByLabelText('Preview de Decision Tree');
    expect(video.getAttribute('src')).toContain(
      '/open-design/hyperframes/previews/frame-decision-tree/preview.mp4',
    );
    expect(screen.getByText(/usa scripts/i)).toBeTruthy();

    const save = vi.spyOn(service, 'saveDesignVideo');
    fireEvent.click(screen.getByRole('button', { name: /Guardar MP4/i }));
    await screen.findByText(/Guardado en/);
    expect(save).toHaveBeenCalledWith('AQID', 'hyperframe-preview-frame-decision-tree.mp4');

    const stage = vi.spyOn(service, 'stageDesignMedia');
    fireEvent.click(screen.getByRole('button', { name: /Enviar a Medios/i }));
    await screen.findByText(/En Medios como/);
    expect(stage).toHaveBeenCalledWith('AQID', 'mp4');
    fireEvent.click(screen.getByRole('button', { name: /Montar en la timeline/i }));
  });

  it('muestra el error real del render', async () => {
    renderView();
    vi.mocked(renderHyperframeToVideo).mockRejectedValueOnce(
      new Error('La composición usa scripts; no se puede renderizar sin ejecutarlos.'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Renderizar MP4/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('usa scripts');
  });
});
