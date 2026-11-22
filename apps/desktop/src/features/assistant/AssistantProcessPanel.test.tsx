// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorJob } from '../../state/orchestrator';
import {
  AssistantProcessPanel,
  classifyActionSummary,
  jobToProcessItem,
  processActionLabel,
  type ProcessItem,
} from './AssistantProcessPanel';

afterEach(cleanup);

const NOW = '2025-01-01T00:00:00.000Z';

function factoryJob(patch: Partial<OrchestratorJob> = {}): OrchestratorJob {
  return {
    schema: 'editor-ia.orchestrator-job.v1',
    id: 'job-1',
    name: 'Video de prueba',
    createdAt: NOW,
    updatedAt: NOW,
    status: 'running',
    stage: 'render',
    progress: 0.5,
    options: {
      brief: 'un brief lo bastante largo',
      scenes: 3,
      language: 'es',
      width: 1920,
      height: 1080,
      fpsNum: 30,
      fpsDen: 1,
      outputDir: 'C:\\out',
      mediaIds: [],
      voiceProvider: 'windows-sapi',
      photoMotion: 'auto',
      transitionFrames: 12,
      includeCaptions: true,
      renderVideo: true,
      generateMedia: false,
      flowKind: 'image',
      flowModel: 'm',
      flowRatio: '16:9',
      flowDuration: '6s',
      approveCredits: false,
      confirmRights: true,
    },
    log: [{ at: NOW, level: 'info', message: 'Render en curso.' }],
    cost: { generations: 0, creditsApproved: false },
    ...patch,
  } as OrchestratorJob;
}

function item(patch: Partial<ProcessItem> = {}): ProcessItem {
  return {
    id: 'i1',
    at: 1,
    status: 'ok',
    title: 'Acción de prueba',
    ...patch,
  };
}

describe('AssistantProcessPanel', () => {
  it('muestra el vacío honesto cuando no hay actividad', () => {
    render(<AssistantProcessPanel items={[]} canRetryJobs={false} />);
    expect(screen.getByText('La IA todavía no ejecutó nada.')).toBeTruthy();
  });

  it('lista los ítems con estado legible', () => {
    render(
      <AssistantProcessPanel
        items={[
          item({ id: 'a', at: 1, title: 'Cortar silencios', status: 'ok' }),
          item({ id: 'b', at: 2, title: 'Montar carpeta', status: 'running', detail: 'Render · 50%' }),
          item({ id: 'c', at: 3, title: 'Job fallido', status: 'error', detail: 'sin salida' }),
        ]}
        canRetryJobs={false}
      />,
    );
    expect(screen.getByText('Cortar silencios')).toBeTruthy();
    expect(screen.getByText('Listo')).toBeTruthy();
    expect(screen.getByText('Ejecutando')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Render · 50%')).toBeTruthy();
    expect(screen.getByText('sin salida')).toBeTruthy();
  });

  it('muestra badge de actividad en curso', () => {
    render(
      <AssistantProcessPanel
        items={[item({ status: 'running' }), item({ id: 'x', status: 'pending' })]}
        canRetryJobs={false}
      />,
    );
    expect(screen.getByText('2 en curso')).toBeTruthy();
  });

  it('colapsa y expande la sección', () => {
    render(<AssistantProcessPanel items={[item()]} canRetryJobs={false} />);
    const head = screen.getByRole('button', { name: /Proceso/ });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Acción de prueba')).toBeNull();
    fireEvent.click(head);
    expect(screen.getByText('Acción de prueba')).toBeTruthy();
  });

  it('ofrece Reintentar sólo en jobs con error y cuando se puede reintentar', () => {
    const job = factoryJob({ status: 'error', error: 'falló el render' });
    const onRetry = vi.fn();
    const { rerender } = render(
      <AssistantProcessPanel
        items={[jobToProcessItem(job)]}
        canRetryJobs
        onRetryJob={onRetry}
      />,
    );
    const button = screen.getByRole('button', { name: 'Reintentar' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(screen.getByText('falló el render')).toBeTruthy();

    // Sin permiso de reintento (hay otro job activo o no hay proyecto) no hay botón.
    rerender(
      <AssistantProcessPanel
        items={[jobToProcessItem(job)]}
        canRetryJobs={false}
        onRetryJob={onRetry}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it('rotula «Reanudar render» cuando el job ya escribió el proyecto', () => {
    const job = factoryJob({
      status: 'error',
      error: 'ffmpeg falló',
      projectPath: 'C:\\out\\video.elyvia.json',
      profileId: 'p1',
    });
    render(
      <AssistantProcessPanel
        items={[jobToProcessItem(job)]}
        canRetryJobs
        onRetryJob={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reanudar render' })).toBeTruthy();
  });

  it('no ofrece reintento para acciones del chat (sin job)', () => {
    render(
      <AssistantProcessPanel
        items={[item({ status: 'error', detail: 'No pude hacerlo.' })]}
        canRetryJobs
        onRetryJob={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
  });
});

describe('jobToProcessItem', () => {
  it('mapea estados del orquestador a estados del panel', () => {
    expect(jobToProcessItem(factoryJob({ status: 'queued' })).status).toBe('pending');
    expect(jobToProcessItem(factoryJob({ status: 'running' })).status).toBe('running');
    expect(jobToProcessItem(factoryJob({ status: 'done' })).status).toBe('ok');
    expect(jobToProcessItem(factoryJob({ status: 'cancelled' })).status).toBe('cancelled');
    expect(jobToProcessItem(factoryJob({ status: 'error' })).status).toBe('error');
  });

  it('incluye etapa y progreso para trabajos en curso', () => {
    const mapped = jobToProcessItem(factoryJob({ stage: 'narration', progress: 0.4 }));
    expect(mapped.detail).toBe('Voz · 40%');
    expect(mapped.note).toBe('Render en curso.');
  });
});

describe('processActionLabel', () => {
  it('devuelve null para acciones que no son pipeline', () => {
    expect(processActionLabel({ kind: 'play' })).toBeNull();
    expect(processActionLabel({ kind: 'navigate', view: 'editor' } as never)).toBeNull();
    expect(processActionLabel({ kind: 'status' })).toBeNull();
    expect(processActionLabel({ kind: 'help' } as never)).toBeNull();
    expect(processActionLabel({ kind: 'unknown', message: 'x' } as never)).toBeNull();
  });

  it('genera nombres legibles en español', () => {
    expect(processActionLabel({ kind: 'auto_pilot' })?.title).toBe(
      'Piloto automático (guion → render)',
    );
    expect(processActionLabel({ kind: 'brain', mode: 'safe' })?.title).toBe(
      'Edición segura del cerebro',
    );
    expect(
      processActionLabel({ kind: 'media_folder', folder: 'video 1' })?.title,
    ).toBe('Montar carpeta «video 1»');
    expect(
      processActionLabel({ kind: 'import_file', path: 'C:\\descargas\\clip.mp4' })?.title,
    ).toBe('Importar «clip.mp4»');
    expect(
      processActionLabel({ kind: 'auto_subtitles', scope: 'project' })?.detail,
    ).toBe('todo el proyecto');
    expect(
      processActionLabel({ kind: 'cut_silences', thresholdDb: -40, minSilenceSeconds: 0.8, paddingSeconds: 0.1, scope: 'project' })
        ?.title,
    ).toBe('Cortar silencios');
  });
});

describe('classifyActionSummary', () => {
  it('clasifica ok, error y waiting', () => {
    expect(classifyActionSummary(null)).toBe('ok');
    expect(classifyActionSummary('Abriendo Editor.')).toBe('ok');
    expect(classifyActionSummary('Limpieza automática: 3 cambios.')).toBe('ok');
    expect(classifyActionSummary('No pude guardar el proyecto.')).toBe('error');
    expect(classifyActionSummary('No hay un proyecto abierto.')).toBe('error');
    expect(classifyActionSummary('La limpieza no dejó el proyecto en un estado válido; no se aplicó.')).toBe('error');
    expect(classifyActionSummary('Quiero borrar el clip seleccionado. Confirmá abajo para que se ejecute.')).toBe('waiting');
    expect(classifyActionSummary('«X» necesita confirmación por su nivel de riesgo.')).toBe('waiting');
  });
});
