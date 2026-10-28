// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import type { AudioPeaks } from '../../services/project-service';
import { Inspector } from './Inspector';
import { SilenceCutsSection } from './SilenceCutsSection';

const NOW = '2026-10-26T00:00:00.000Z';

afterEach(cleanup);

function peaksFromPattern(
  pattern: readonly ('voz' | 'silencio')[],
  secondsPerBucket = 0.1,
): AudioPeaks {
  return {
    assetId: 'asset-1',
    durationSeconds: pattern.length * secondsPerBucket,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.6, max: 0.6 } : { min: -0.001, max: 0.001 },
    ),
  };
}

/** 10 s: voz 0–3 s, silencio 3–5 s, voz 5–8 s, silencio 8–10 s. */
const NARRACION: readonly ('voz' | 'silencio')[] = [
  ...Array.from({ length: 30 }, () => 'voz' as const),
  ...Array.from({ length: 20 }, () => 'silencio' as const),
  ...Array.from({ length: 30 }, () => 'voz' as const),
  ...Array.from({ length: 20 }, () => 'silencio' as const),
];

function audioAsset() {
  return readyAsset({
    kind: 'audio',
    label: 'Narración de prueba',
    source: { type: 'local', path: 'media/narracion.wav' },
    media: { sampleRate: 48000, channels: 1, durationFrames: 300 },
  });
}

function projectWithAudioClips(count: number): {
  project: ProjectDocument;
  assetId: string;
  clipId: string;
  trackId: string;
} {
  const asset = audioAsset();
  let project = addAsset(ensureDelivery(createEmptyProject('Silencios', NOW)), asset);
  let clipId = '';
  let trackId = '';
  for (let index = 0; index < count; index += 1) {
    const added = addClipFromAsset(project, asset, {
      atFrame: index * 400,
      durationFrames: 300,
    });
    project = added.project;
    clipId = added.clipId;
    trackId = added.trackId;
  }
  return { project, assetId: asset.id, clipId, trackId };
}

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;

function ProjectProbe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
  }, [store.state]);
  return null;
}

function SelectOnMount(props: { kind: 'clip' | 'track'; id: string }): null {
  const store = useProjectStore();
  useEffect(() => {
    store.setSelection({ kind: props.kind, id: props.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderSection(options?: {
  clipCount?: number;
  peaks?: AudioPeaks;
  inspector?: 'clip' | 'track';
}) {
  const built = projectWithAudioClips(options?.clipCount ?? 1);
  const service = createFakeService();
  vi.spyOn(service, 'audioPeaks').mockResolvedValue(
    options?.peaks ?? peaksFromPattern(NARRACION),
  );
  latestState = null;
  const view = render(
    <ProjectProvider
      service={service}
      initial={{
        project: built.project,
        opened: {
          project: built.project,
          label: 'silencios.editoria.json',
          path: 'C:\\tester\\silencios.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ProjectProbe />
      {options?.inspector ? (
        <>
          <SelectOnMount
            kind={options.inspector}
            id={options.inspector === 'track' ? built.trackId : built.clipId}
          />
          <Inspector />
        </>
      ) : (
        <SilenceCutsSection clips={built.project.timeline.clips} />
      )}
    </ProjectProvider>,
  );
  return { view, service, project: built.project, clipId: built.clipId, trackId: built.trackId };
}

function totalDuration(project: ProjectDocument | null): number {
  if (!project) return -1;
  return project.timeline.clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
}

function setColchon(value: string): void {
  const padding = screen.getByLabelText('Colchón (s)') as HTMLInputElement;
  fireEvent.change(padding, { target: { value } });
  fireEvent.blur(padding);
}

describe('Sección cortar silencios', () => {
  it('analiza los picos y muestra cuánto recortaría', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    const preview = await screen.findByTestId('silence-plan');
    expect(preview.textContent).toContain('2 silencio(s) en 1 clip(s)');
    expect(preview.textContent).toContain('≈ 3.40 s');
    expect(preview.textContent).toContain('34% del material analizado');
    expect(preview.textContent).toContain('Narración de prueba: 2 silencio(s) · 3.40 s');
    // Sin confirmar todavía, el proyecto no cambió.
    expect(latestState?.project?.timeline.clips).toHaveLength(1);
  });

  it('cambia el colchón, invalida la vista previa y reanaliza', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await screen.findByTestId('silence-plan');
    setColchon('0.2');
    // Los parámetros nuevos invalidan el plan viejo.
    expect(screen.queryByTestId('silence-plan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    const preview = await screen.findByTestId('silence-plan');
    expect(preview.textContent).toContain('≈ 3.20 s');
    expect(preview.textContent).toContain('32% del material analizado');
  });

  it('pide confirmación antes de aplicar y recorta con ripple', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await screen.findByTestId('silence-plan');
    // Colchón 0.2 s: los bordes del silencio caen en frames enteros (30 fps).
    setColchon('0.2');
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await screen.findByTestId('silence-plan');

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar cortes' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar: eliminar 3\.20 s/ }));

    await waitFor(() => {
      expect(latestState?.project?.timeline.clips).toHaveLength(3);
    });
    const project = latestState?.project ?? null;
    // 2 silencios de 1,6 s cada uno: 300 − 96 = 204 frames remanentes.
    expect(totalDuration(project)).toBe(204);
    expect(project?.timeline.clips[0]?.startFrame).toBe(0);
    expect(latestState?.notice).toContain('Silencios recortados en 1 clip(s)');
    expect(latestState?.notice).toContain('3.20 s');
  });

  it('no toca el proyecto si se cancela la confirmación', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await screen.findByTestId('silence-plan');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar cortes' }));
    expect(screen.getByRole('button', { name: /Confirmar: eliminar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Aplicar cortes' })).toBeTruthy();
    expect(latestState?.project?.timeline.clips).toHaveLength(1);
    expect(totalDuration(latestState?.project ?? null)).toBe(300);
  });

  it('bloquea la aplicación cuando el plan es excesivo', async () => {
    const excesivo = peaksFromPattern([
      ...Array.from({ length: 5 }, () => 'voz' as const),
      ...Array.from({ length: 95 }, () => 'silencio' as const),
    ]);
    renderSection({ peaks: excesivo });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await screen.findByTestId('silence-plan');
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('más del 80%');
    const aplicar = screen.getByRole('button', { name: 'Aplicar cortes' }) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    expect(latestState?.project?.timeline.clips).toHaveLength(1);
  });

  it('avisa cuando no hay silencios que recortar', async () => {
    const todaVoz = peaksFromPattern(Array.from({ length: 100 }, () => 'voz' as const));
    renderSection({ peaks: todaVoz });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    await waitFor(() => {
      expect(screen.getByText(/No hay silencios que recortar/i)).toBeTruthy();
    });
    expect(screen.queryByTestId('silence-plan')).toBeNull();
  });

  it('resume y aplica varios clips al analizar desde una pista', async () => {
    renderSection({ clipCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar silencios' }));
    const preview = await screen.findByTestId('silence-plan');
    expect(preview.textContent).toContain('4 silencio(s) en 2 clip(s)');
    expect(preview.textContent).toContain('≈ 6.80 s');

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar cortes' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar: eliminar 6\.80 s/ }));
    await waitFor(() => {
      expect(latestState?.project?.timeline.clips).toHaveLength(6);
    });
    // Cada clip conserva 198 frames (102 recortados con el colchón por
    // defecto): 600 − 204 = 396.
    expect(totalDuration(latestState?.project ?? null)).toBe(396);
    expect(latestState?.notice).toContain('Silencios recortados en 2 clip(s)');
  });

  it('aparece en el Inspector al seleccionar un clip de audio', async () => {
    renderSection({ inspector: 'clip' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Cortar silencios' })).toBeTruthy();
    });
    expect(screen.getByLabelText('Umbral (dBFS)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Analizar silencios' })).toBeTruthy();
  });

  it('aparece en el Inspector al seleccionar una pista de audio', async () => {
    renderSection({ inspector: 'track' });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Cortar silencios de la pista' }),
      ).toBeTruthy();
    });
  });
});
