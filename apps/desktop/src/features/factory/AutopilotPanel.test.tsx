// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import type { DesktopService } from '../../services/project-service';
import { newId } from '../../state/project-actions';
import { addAsset } from '../../state/project-actions';
import { ORCHESTRATOR_STORAGE_KEY } from '../../state/orchestrator';
import { AutopilotPanel } from './AutopilotPanel';

function project() {
  const asset: Asset = {
    id: newId(),
    label: '001-faro.png',
    kind: 'image',
    source: { type: 'local', path: 'media/001-faro.png' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: '2026-10-20T00:00:00.000Z' },
    },
    media: { width: 1920, height: 1080 },
  } as Asset;
  return addAsset(createEmptyProject('Prueba', '2026-10-20T00:00:00.000Z'), asset);
}

function service(): DesktopService {
  return {
    listMcpServers: vi.fn(async () => [
      {
        id: 'flow',
        name: 'Google Flow',
        command: 'node',
        args: [],
        envKeys: [],
        workingDir: null,
        enabled: true,
      },
    ]),
    revealOutput: vi.fn(async () => {}),
  } as unknown as DesktopService;
}

const defaults = {
  brief: 'Un video de prueba sobre faros.',
  scenes: 3,
  language: 'es',
  width: 1920,
  height: 1080,
  outputDir: 'C:/salida',
  photoMotion: 'auto' as const,
  transitionFrames: 8,
  renderVideo: false,
  confirmRights: true,
};

describe('panel de autopiloto', () => {
  beforeEach(() => {
    localStorage.removeItem(ORCHESTRATOR_STORAGE_KEY);
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(ORCHESTRATOR_STORAGE_KEY);
  });

  it('monta los controles, los medios y el servidor MCP sin ejecutar nada', async () => {
    render(
      <AutopilotPanel
        project={project()}
        service={service()}
        defaults={defaults}
        onOpenProject={async () => true}
        onNavigateEditor={() => {}}
        onNavigateMcp={() => {}}
      />,
    );

    expect(screen.getByText('Autopiloto IA')).toBeTruthy();
    expect(screen.getByText('001-faro.png')).toBeTruthy();
    const generate = screen.getByRole('checkbox', { name: /Generar una imagen/i });
    expect((generate as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Servidor MCP')).toBeNull();

    fireEvent.click(generate);
    expect(await screen.findByText('Servidor MCP')).toBeTruthy();
    expect(await screen.findByText('Google Flow')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ejecutar autopiloto/i })).toBeTruthy();
    expect(screen.getByText('0 trabajo(s)')).toBeTruthy();
  });

  it('restaura trabajos guardados de la cola', async () => {
    localStorage.setItem(
      ORCHESTRATOR_STORAGE_KEY,
      JSON.stringify([
        {
          schema: 'editor-ia.orchestrator-job.v1',
          id: 'job-1',
          name: 'Trabajo previo',
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T00:00:00.000Z',
          status: 'done',
          stage: 'done',
          progress: 1,
          options: {
            brief: 'Un brief que ya se ejecutó.',
            scenes: 2,
            language: 'es',
            width: 1920,
            height: 1080,
            fpsNum: 30,
            fpsDen: 1,
            outputDir: 'C:/salida',
            mediaIds: [],
            voiceProvider: 'windows-sapi',
            photoMotion: 'auto',
            transitionFrames: 8,
            includeCaptions: true,
            renderVideo: false,
            generateMedia: false,
            flowKind: 'image',
            flowModel: 'Nano Banana 2',
            flowRatio: '16:9',
            flowDuration: '6s',
            approveCredits: false,
            confirmRights: true,
          },
          log: [],
          cost: { generations: 0, creditsApproved: false },
        },
      ]),
    );

    render(
      <AutopilotPanel
        project={project()}
        service={service()}
        defaults={defaults}
        onOpenProject={async () => true}
        onNavigateEditor={() => {}}
        onNavigateMcp={() => {}}
      />,
    );

    expect(screen.getByText('Trabajo previo')).toBeTruthy();
    expect(screen.getByText(/Completado/)).toBeTruthy();
  });
});
