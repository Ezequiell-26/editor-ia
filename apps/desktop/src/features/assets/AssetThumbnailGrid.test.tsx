// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery, newId } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';
import { AssetThumbnailGrid } from './AssetThumbnailGrid';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function baseAsset(kind: Asset['kind'], media: Record<string, unknown>): Asset {
  return {
    id: newId(),
    label: `${kind}.bin`,
    kind,
    source: { type: 'local', path: `media/${kind}.bin` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 1000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media,
  } as Asset;
}

/**
 * `durationFrames` se persiste en frames DEL PROYECTO (media/mod.rs), no en
 * los fps nativos del archivo: con proyecto a 24 fps, 2400 frames son 100 s.
 * El grid antes dividía siempre por 30 y mentía la duración.
 */
function renderGrid(assets: Asset[], fps = 24) {
  const project = ensureDelivery(createEmptyProject('Duraciones', NOW));
  project.video.frameRate = { num: fps, den: 1 };
  project.assets = assets;
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'duraciones.editoria.json',
          path: 'C:\\tester\\duraciones.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AssetThumbnailGrid
        assets={assets}
        root="C:\\tester"
        onAssetClick={vi.fn()}
        onAssetDoubleClick={vi.fn()}
        selectedAssetId={null}
        viewMode="grid"
      />
    </ProjectProvider>,
  );
}

describe('AssetThumbnailGrid · duraciones reales', () => {
  it('el badge de video usa el fps del proyecto, no 30 fijo', () => {
    const clip = baseAsset('video', {
      width: 1920,
      height: 1080,
      durationFrames: 1440, // 60 s a 24 fps
      frameRate: { num: 24, den: 1 },
    });
    renderGrid([clip]);
    expect(screen.getByText('1:00')).toBeTruthy();
  });

  it('la duración de audio en lista usa el fps del proyecto', () => {
    const voice = baseAsset('audio', {
      sampleRate: 48_000,
      channels: 1,
      durationFrames: 2400, // 100 s a 24 fps
    });
    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project: (() => {
            const project = ensureDelivery(createEmptyProject('Duraciones', NOW));
            project.video.frameRate = { num: 24, den: 1 };
            return project;
          })(),
          opened: null,
        }}
      >
        <AssetThumbnailGrid
          assets={[voice]}
          root="C:\\tester"
          onAssetClick={vi.fn()}
          onAssetDoubleClick={vi.fn()}
          selectedAssetId={null}
          viewMode="list"
        />
      </ProjectProvider>,
    );
    expect(screen.getByText(/100s/)).toBeTruthy();
  });
});
