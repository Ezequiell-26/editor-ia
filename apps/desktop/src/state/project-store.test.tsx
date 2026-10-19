// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeService } from '../test/fake-service';
import { addTrack, ensureDelivery } from './project-actions';
import { ProjectProvider, useProjectStore } from './project-store';

function Harness() {
  const store = useProjectStore();
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          store.update((project) => addTrack(project, 'video').project);
        }}
      >
        editar
      </button>
      <button
        type="button"
        onClick={() => {
          void store.saveNow().then(setResult);
        }}
      >
        guardar
      </button>
      <span role="status">{store.state.phase}</span>
      <span data-testid="result">{String(result ?? 'none')}</span>
    </div>
  );
}

function deferred<T>() {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(cleanup);

describe('autoguardado', () => {
  it('no declara guardado si aparecen cambios nuevos durante el await', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Carrera', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'carrera.editoria.json',
      path: 'C:\\tmp\\carrera.editoria.json',
      root: 'C:\\tmp',
    };
    service.current = opened;
    const pending = deferred<typeof opened>();
    service.saveProject = () => pending.promise;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Harness />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    pending.release(opened);
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('false');
    });
    expect(screen.getByRole('status').textContent).toBe('dirty');
  });
});
