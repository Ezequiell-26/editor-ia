// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DubResult } from '../../services/project-service';
import { DubResultCard } from './DubResultCard';

afterEach(cleanup);

const result: DubResult = {
  path: 'C:\\salida\\doblaje-en.mp4',
  bytes: 12_400_000,
  width: 1080,
  height: 1920,
  durationSeconds: 5,
  language: 'en',
  voice: 'Microsoft Zira Desktop',
  cues: 2,
  replacedOriginalAudio: false,
  originalAudioVolume: 0.15,
  warnings: [],
};

describe('DubResultCard', () => {
  it('resume el MP4 y permite importarlo o abrir la carpeta', () => {
    const onImport = vi.fn();
    const onReveal = vi.fn();
    const onOpenMedia = vi.fn();
    render(
      <DubResultCard
        result={result}
        importing={false}
        imported={false}
        onImport={onImport}
        onReveal={onReveal}
        onOpenMedia={onOpenMedia}
      />,
    );

    expect(screen.getByText(/1080×1920/)).toBeTruthy();
    expect(screen.getByText(/Microsoft Zira Desktop/)).toBeTruthy();
    expect(screen.getByText(/Audio original al 15%/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Importar al proyecto/i }));
    expect(onImport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Mostrar en carpeta/i }));
    expect(onReveal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /Ver en Medios/i })).toBeNull();
  });

  it('muestra el estado importado y no repite la importación', () => {
    const onOpenMedia = vi.fn();
    render(
      <DubResultCard
        result={result}
        importing={false}
        imported
        onImport={() => {}}
        onReveal={() => {}}
        onOpenMedia={onOpenMedia}
      />,
    );

    const imported = screen.getByRole('button', { name: /Importado al proyecto/i });
    expect((imported as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Ver en Medios/i }));
    expect(onOpenMedia).toHaveBeenCalledOnce();
  });

  it('bloquea el botón mientras importa', () => {
    render(
      <DubResultCard
        result={result}
        importing
        imported={false}
        onImport={() => {}}
        onReveal={() => {}}
        onOpenMedia={() => {}}
      />,
    );
    expect(
      (screen.getByRole('button', { name: /Importando/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
