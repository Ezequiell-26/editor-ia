import { Profiler, useCallback, useRef, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';

/**
 * Cuanto trabajo de React cuesta mover el cabezal.
 *
 * No mide FPS: en jsdom no hay paint. Cuenta las commits que React hace por
 * tick de reproduccion, que es lo que define si el cabezal se ve fluido o a
 * saltos en el runtime real (cada commit compite con el rAF del preview y con
 * el decode de frame). Si alguien parte el store en slices (cabezal aparte del
 * documento), estos numeros tienen que bajar.
 */

const NOW = '2026-10-20T00:00:00.000Z';
type Counters = Record<string, { commits: number; ms: number }>;

function Panel({ label, counters, children }: { label: string; counters: Counters; children: ReactNode }) {
  const onRender = useCallback(
    (_id: string, _phase: unknown, actualDuration: number) => {
      const bucket = (counters[label] ??= { commits: 0, ms: 0 });
      bucket.commits += 1;
      bucket.ms += actualDuration;
    },
    [label, counters],
  );
  return (
    <Profiler id={label} onRender={onRender}>
      {children}
    </Profiler>
  );
}

/** Saca el store hacia afuera para mover el cabezal como lo hace usePlayback. */
function StoreHandle({ onReady }: { onReady: (api: { setPlayhead: (frame: number) => void }) => void }) {
  const store = useProjectStore();
  const sent = useRef(false);
  if (!sent.current) {
    sent.current = true;
    onReady({ setPlayhead: store.setPlayhead });
  }
  return null;
}

afterEach(() => {
  cleanup();
});

describe('costo de React por tick de cabezal', () => {
  it('cuenta las commits de Timeline e Inspector al avanzar 30 frames', () => {
    const base = ensureDelivery(createEmptyProject('Medicion', NOW));
    const asset = readyAsset();
    const project = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 300,
    }).project;

    const counters: Counters = {};
    let api: { setPlayhead: (frame: number) => void } | null = null;

    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project,
          opened: {
            project,
            label: 'medicion.editoria.json',
            path: 'C:\\tester\\medicion.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <StoreHandle onReady={(value) => (api = value)} />
        <Panel label="Timeline" counters={counters}>
          <Timeline />
        </Panel>
        <Panel label="Inspector" counters={counters}>
          <Inspector />
        </Panel>
      </ProjectProvider>,
    );

    expect(api).not.toBeNull();

    // Un act() por frame: sin esto React batchea los 30 updates en una unica
    // commit y la medicion mentira (daria ~1 en vez del costo real por tick).
    for (let frame = 1; frame <= 30; frame += 1) {
      act(() => {
        api!.setPlayhead(frame);
      });
    }

    const timeline = counters.Timeline ?? { commits: 0, ms: 0 };
    const inspector = counters.Inspector ?? { commits: 0, ms: 0 };
    // eslint-disable-next-line no-console
    console.info(
      `[render-cost] 30 ticks -> Timeline: ${timeline.commits} commits, ${timeline.ms.toFixed(1)} ms (${(timeline.ms / 30).toFixed(2)} ms/tick) | ` +
        `Inspector: ${inspector.commits} commits, ${inspector.ms.toFixed(1)} ms (${(inspector.ms / 30).toFixed(2)} ms/tick)`,
    );

    expect(timeline.commits).toBeGreaterThan(0);
    expect(inspector.commits).toBeGreaterThan(0);
  });
});
