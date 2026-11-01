// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { App } from '../../App';
import { newId } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';

const NOW = '2025-01-01T00:00:00.000Z';

function readyImage(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 1_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080 },
  } as Asset;
}

function readyAudio(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'audio',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 1_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 2, durationFrames: 1_800 },
  } as Asset;
}

afterEach(cleanup);

function openAssistant(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Olyvia' }));
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText('Mensaje para Olyvia'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
}

describe('Olyvia Assistant', () => {
  it('abre el chat flotante y ejecuta un comando local sin tokens', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    expect(screen.getByRole('dialog', { name: 'Asistente Olyvia' })).toBeTruthy();
    send('abrir editor');
    expect(await screen.findByText('Abriendo Editor.')).toBeTruthy();
  });

  it('monta una carpeta de Descargas sin proveedor', async () => {
    const service = createFakeService();
    const imagePath = 'C:\\Users\\tester\\Downloads\\video 1\\Escena 1.jpg';
    const audioPath = 'C:\\Users\\tester\\Downloads\\video 1\\Tema.wav';
    service.listMediaFolder = async () => ({
      directory: 'C:\\Users\\tester\\Downloads\\video 1',
      files: [
        { path: imagePath, name: 'Escena 1.jpg', kind: 'image', bytes: 1_000 },
        { path: audioPath, name: 'Tema.wav', kind: 'audio', bytes: 1_000 },
      ],
    });
    service.importMediaPaths = async () => ({
      assets: [readyImage('Escena 1.jpg'), readyAudio('Tema.wav')],
      warnings: [],
    });
    render(<App service={service} />);
    openAssistant();
    send('usá los archivos de descargas de la carpeta video 1');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(
      await screen.findByText(/Monté 1 imagen\(es\) \+ audio de «video 1»/),
    ).toBeTruthy();
    expect(screen.queryByText(/Soy Olyvia en modo simulado/i)).toBeNull();
  });

  it('consulta al proveedor cuando el comando no es local', async () => {
    render(<App service={createFakeService()} />);
    openAssistant();
    send('contame algo');
    expect(await screen.findByText(/Soy Olyvia en modo simulado/i)).toBeTruthy();
  });

  it('muestra el peluche dentro del chat y reacciona al foco', () => {
    render(<App service={createFakeService()} />);
    expect(document.querySelector('.pet-avatar')).toBeNull();

    const launcher = screen.getByRole('button', { name: 'Abrir asistente Olyvia' });
    fireEvent.click(launcher);

    const pet = document.querySelector('.pet-avatar');
    expect(pet).toBeTruthy();
    expect(pet?.querySelector('img')?.getAttribute('src')).toBe('/olyvia-pet.webp');

    const input = screen.getByLabelText('Mensaje para Olyvia');
    fireEvent.blur(input);
    expect(pet?.className).toContain('is-awake');
    fireEvent.focus(input);
    expect(pet?.className).toContain('is-listening');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente Olyvia' }));
    expect(document.querySelector('.pet-avatar')).toBeNull();
  });
});
