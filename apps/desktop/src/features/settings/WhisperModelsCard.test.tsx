// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../../state/project-store';
import type { NativeWhisperStatus } from '../../services/project-service';
import { createFakeService } from '../../test/fake-service';
import {
  WhisperModelsCard,
  canDownloadWhisperModel,
  whisperMegabytes,
  whisperProgressLabel,
  whisperProgressPercent,
} from './WhisperModelsCard';

afterEach(cleanup);

function renderCard(service: ReturnType<typeof createFakeService>) {
  render(
    <ProjectProvider service={service}>
      <WhisperModelsCard />
    </ProjectProvider>,
  );
}

function statusWith(overrides: Partial<NativeWhisperStatus> = {}): NativeWhisperStatus {
  return {
    engineAvailable: true,
    modelsDir: 'C:\\cfg\\whisper-models',
    models: [
      {
        id: 'tiny',
        label: 'Whisper tiny',
        blurb: 'El más rápido.',
        englishOnly: false,
        sizeBytes: 75 * 1024 * 1024,
        downloaded: true,
        path: 'C:\\cfg\\whisper-models\\ggml-tiny.bin',
      },
      {
        id: 'small',
        label: 'Whisper small',
        blurb: 'Más preciso.',
        englishOnly: false,
        sizeBytes: 466 * 1024 * 1024,
        downloaded: false,
        path: null,
      },
    ],
    loadedModel: 'tiny',
    busy: false,
    download: { running: false, modelId: null, progress: null, error: null },
    ...overrides,
  };
}

describe('helpers de la tarjeta whisper', () => {
  it('formatea megabytes legibles', () => {
    expect(whisperMegabytes(75 * 1024 * 1024)).toBe('75.0 MB');
    expect(whisperMegabytes(466 * 1024 * 1024)).toBe('466 MB');
    expect(whisperMegabytes(0)).toBe('—');
  });

  it('prefiere el percent del backend y cae a received/total', () => {
    expect(
      whisperProgressPercent({
        modelId: 'tiny',
        received: 50,
        total: 100,
        unpacking: false,
        done: false,
        percent: 55.4,
      }),
    ).toBe(55);
    expect(
      whisperProgressPercent({
        modelId: 'tiny',
        received: 25,
        total: 100,
        unpacking: false,
        done: false,
        percent: null,
      }),
    ).toBe(25);
    expect(
      whisperProgressPercent({
        modelId: 'tiny',
        received: 10,
        total: 0,
        unpacking: false,
        done: false,
        percent: null,
      }),
    ).toBeNull();
  });

  it('etiqueta la fase real del progreso', () => {
    const base = { modelId: 'tiny', received: 0, total: 100, percent: null };
    expect(whisperProgressLabel({ ...base, unpacking: true, done: false })).toContain(
      'Verificando',
    );
    expect(whisperProgressLabel({ ...base, unpacking: false, done: true })).toBe(
      'Descarga completa',
    );
    expect(whisperProgressLabel({ ...base, unpacking: false, done: false })).toBe(
      'Descargando…',
    );
  });

  it('sólo permite descargar modelos pendientes con motor y sin descarga activa', () => {
    const status = statusWith();
    const pendiente = status.models[1]!;
    const descargado = status.models[0]!;
    expect(canDownloadWhisperModel(pendiente, status)).toBe(true);
    expect(canDownloadWhisperModel(descargado, status)).toBe(false);
    expect(
      canDownloadWhisperModel(pendiente, {
        ...status,
        download: { running: true, modelId: 'base', progress: null, error: null },
      }),
    ).toBe(false);
    expect(canDownloadWhisperModel(pendiente, { ...status, engineAvailable: false })).toBe(
      false,
    );
    expect(canDownloadWhisperModel(pendiente, null)).toBe(false);
  });
});

describe('tarjeta de modelos whisper', () => {
  it('lista los modelos con tamaño, badge y modelo cargado', async () => {
    const service = createFakeService();
    service.whisperModelStatus = async () => statusWith();
    renderCard(service);

    expect(await screen.findByText('Modelos Whisper (nativo)')).toBeTruthy();
    expect(screen.getByText('Motor disponible')).toBeTruthy();
    expect(screen.getByText(/Whisper tiny/)).toBeTruthy();
    expect(screen.getByText(/Whisper small/)).toBeTruthy();
    expect(screen.getByText(/75\.0 MB/)).toBeTruthy();
    expect(screen.getAllByText('Descargado').length).toBeGreaterThan(0);
    expect(screen.getByText('tiny')).toBeTruthy(); // modelo cargado en la lista de datos
    expect(screen.getByText('inactivo')).toBeTruthy();
  });

  it('con engineAvailable=false explica que whisper.cpp no está compilado', async () => {
    const service = createFakeService();
    service.whisperModelStatus = async () =>
      statusWith({
        engineAvailable: false,
        models: statusWith().models.map((model) => ({ ...model, downloaded: false })),
      });
    renderCard(service);

    expect(await screen.findByText('No disponible')).toBeTruthy();
    expect(screen.getByText(/whisper\.cpp no está compilado/i)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /Descargar/i });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('descargar llama al servicio y refresca el estado', async () => {
    const service = createFakeService();
    service.whisperModelStatus = async () => statusWith();
    const download = vi.spyOn(service, 'whisperModelDownload');
    renderCard(service);

    const button = await screen.findByRole('button', { name: 'Descargar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(download).toHaveBeenCalledWith('small'));
    expect(await screen.findByText(/descargado y verificado/i)).toBeTruthy();
  });

  it('muestra el progreso en vivo alimentado por el evento', async () => {
    const service = createFakeService();
    service.whisperModelStatus = async () =>
      statusWith({
        download: {
          running: true,
          modelId: 'small',
          progress: null,
          error: null,
        },
      });
    renderCard(service);

    await screen.findByText('Modelos Whisper (nativo)');
    service.emitWhisperModelDownload({
      modelId: 'small',
      received: 100 * 1024 * 1024,
      total: 400 * 1024 * 1024,
      unpacking: false,
      done: false,
      percent: 25,
    });

    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText(/Descargando… · small/)).toBeTruthy();
    // Con descarga en curso el modelo activo muestra «Descargando…» y queda
    // deshabilitado (no hay forma honesta de cancelar todavía).
    const active = await screen.findByRole('button', { name: /Descargando…/ });
    expect((active as HTMLButtonElement).disabled).toBe(true);
    // El modelo ya descargado sigue mostrando su badge, no un botón.
    expect(screen.getByText('Descargado')).toBeTruthy();
  });

  it('un evento con error se muestra como fallo', async () => {
    const service = createFakeService();
    service.whisperModelStatus = async () => statusWith();
    renderCard(service);

    await screen.findByText('Modelos Whisper (nativo)');
    service.emitWhisperModelDownload({
      modelId: 'small',
      received: 0,
      total: 0,
      unpacking: false,
      done: true,
      percent: null,
      error: 'conexión rechazada por el mirror',
    });

    expect(await screen.findByText(/conexión rechazada por el mirror/)).toBeTruthy();
  });

  it('en modo navegador explica que el estado sólo existe en la app', async () => {
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación.',
    };
    renderCard(service as ReturnType<typeof createFakeService>);
    expect(
      await screen.findByText(/sólo se puede leer en la app de escritorio/i),
    ).toBeTruthy();
  });
});
