// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import type { VisualCatalog, VisualEffectSpec } from '../../services/project-service';
import { EffectBrowser } from './EffectBrowser';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function spec(
  id: string,
  label: string,
  parameters: { key: string; label: string; min: number; max: number; default: number }[],
): VisualEffectSpec {
  return {
    id,
    label,
    category: 'color',
    description: `${label} description`,
    filters: ['eq'],
    available: true,
    parameters: parameters.map((item) => ({ ...item, unit: 'range' })),
  };
}

const catalog: VisualCatalog = {
  ffmpegAvailable: true,
  effects: [
    spec('brightness', 'Brillo', [
      { key: 'brightness', label: 'Brillo', min: -1, max: 1, default: 0 },
    ]),
    spec('contrast', 'Contraste', [
      { key: 'contrast', label: 'Contraste', min: 0, max: 3, default: 1 },
    ]),
    spec('temperature', 'Temperatura', [
      { key: 'temperature', label: 'Temperatura', min: -1, max: 1, default: 0 },
    ]),
    spec('denoise', 'Reducción de ruido', [
      { key: 'denoise', label: 'Cantidad', min: 0, max: 1, default: 0.3 },
    ]),
    spec('future-effect', 'Futuro', []),
    spec('blur', 'Desenfoque', [
      { key: 'blur', label: 'Radio', min: 0, max: 50, default: 10 },
    ]),
    spec('lut', 'LUT', [
      { key: 'lutIntensity', label: 'Intensidad', min: 0, max: 1, default: 1 },
    ]),
    spec('glow', 'Glow', [
      { key: 'intensity', label: 'Intensidad', min: 0, max: 1, default: 0.35 },
      { key: 'radius', label: 'Radio', min: 1, max: 80, default: 20 },
      { key: 'threshold', label: 'Umbral', min: 0, max: 0.95, default: 0.6 },
    ]),
    spec('grain', 'Grano', [
      { key: 'grain', label: 'Intensidad', min: 0, max: 1, default: 0.25 },
    ]),
  ],
  presets: [],
  transitions: [],
  filters: [],
};

describe('EffectBrowser', () => {
  it('lists the registry, filters by search and exposes the status', () => {
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={() => {}} />);
    expect(screen.getByText('Brillo')).toBeTruthy();
    expect(screen.getByText('Contraste')).toBeTruthy();
    expect(screen.getByText('Reducción de ruido')).toBeTruthy();
    expect(screen.getByText('Futuro')).toBeTruthy();
    expect(screen.getByText('Solo export')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Buscar efecto'), {
      target: { value: 'ruido' },
    });
    expect(screen.queryByText('Brillo')).toBeNull();
    expect(screen.getByText('Reducción de ruido')).toBeTruthy();
  });

  it('muestra una miniatura con el filtro CSS real del efecto', () => {
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={() => {}} />);
    const card = screen.getByText('Desenfoque').closest('.effect-card');
    const swatch = card?.querySelector('.effect-swatch') as HTMLElement;
    expect(swatch.style.filter).toContain('blur(10px)');
  });

  it('opens a parameter editor, resets and applies the values', () => {
    const onApply = vi.fn();
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={onApply} />);
    fireEvent.click(screen.getByText('Brillo'));
    const slider = screen.getByRole('slider', { name: 'Brillo' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.6' } });
    expect(slider.value).toBe('0.6');
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar valores' }));
    expect(slider.value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar efecto' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'brightness' }),
      expect.objectContaining({ brightness: 0 }),
    );
    expect(localStorage.getItem('olyvia.effects.preferences')).toContain('brightness');
  });

  it('muestra la miniatura animada al pasar el cursor', () => {
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={() => {}} />);
    const card = screen.getByText('Brillo').closest('.effect-card') as HTMLElement;
    fireEvent.mouseEnter(card);
    const video = card.querySelector('video.effect-thumb-preview') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('/effects/thumbs/brightness.webm');
    expect(video.muted).toBe(true);
    fireEvent.mouseLeave(card);
    expect(card.querySelector('video.effect-thumb-preview')).toBeNull();
  });

  it('cambia el perfil de preview y adapta las miniaturas', () => {
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eficiente' }));
    expect(localStorage.getItem('olyvia.preview.profile')).toBe('efficient');
    const card = screen.getByText('Desenfoque').closest('.effect-card');
    const swatch = card?.querySelector('.effect-swatch') as HTMLElement;
    expect(swatch.style.filter).toContain('blur(4px)');
  });

  it('agrega y quita keyframes del clip principal', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 10,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { brightness: 0 },
      effectKeyframes: [
        { frame: 5, property: 'brightness', value: 0.2, easing: 'linear' },
        { frame: 12, property: 'brightness', value: 0.5, easing: 'ease-in' },
      ],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentEffects={{ brightness: 0 }}
        currentClip={currentClip}
        playheadFrame={20}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('Brillo'));
    const section = screen.getByRole('region', { name: 'Keyframes de Brillo' });
    expect(within(section).getByDisplayValue('5')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Agregar keyframe' }));
    expect(onKeyframes).toHaveBeenCalledWith([
      { frame: 5, property: 'brightness', value: 0.2, easing: 'linear' },
      { frame: 10, property: 'brightness', value: 0, easing: 'linear' },
      { frame: 12, property: 'brightness', value: 0.5, easing: 'ease-in' },
    ]);
    fireEvent.click(within(section).getByRole('button', { name: 'Quitar keyframe 1' }));
    expect(onKeyframes).toHaveBeenLastCalledWith([
      { frame: 10, property: 'brightness', value: 0, easing: 'linear' },
      { frame: 12, property: 'brightness', value: 0.5, easing: 'ease-in' },
    ]);
  });

  it('permite keyframear la temperatura', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { temperature: 0 },
      effectKeyframes: [{ frame: 0, property: 'temperature', value: 0, easing: 'linear' }],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentEffects={{ temperature: 0 }}
        currentClip={currentClip}
        playheadFrame={20}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('Temperatura'));
    const section = screen.getByRole('region', { name: 'Keyframes de Temperatura' });
    fireEvent.click(within(section).getByRole('button', { name: 'Agregar keyframe' }));
    expect(onKeyframes).toHaveBeenCalledWith([
      { frame: 0, property: 'temperature', value: 0, easing: 'linear' },
      { frame: 20, property: 'temperature', value: 0, easing: 'linear' },
    ]);
  });

  it('permite keyframear la intensidad del LUT', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { lutFile: 'luts/invert.cube', lutIntensity: 1 },
      effectKeyframes: [
        { frame: 0, property: 'lutIntensity', value: 0, easing: 'linear' },
      ],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentClip={currentClip}
        currentEffects={{ lutFile: 'luts/invert.cube', lutIntensity: 1 }}
        playheadFrame={20}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('LUT'));
    const section = screen.getByRole('region', { name: 'Keyframes de LUT' });
    fireEvent.click(within(section).getByRole('button', { name: 'Agregar keyframe' }));
    expect(onKeyframes).toHaveBeenCalledWith([
      { frame: 0, property: 'lutIntensity', value: 0, easing: 'linear' },
      { frame: 20, property: 'lutIntensity', value: 1, easing: 'linear' },
    ]);
  });

  it('permite keyframear la intensidad de glow', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { glow: { intensity: 0.2, radius: 20, threshold: 0.6 } },
      effectKeyframes: [
        { frame: 0, property: 'glowIntensity', value: 0, easing: 'linear' },
      ],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentClip={currentClip}
        currentEffects={{ glow: { intensity: 0.2, radius: 20, threshold: 0.6 } }}
        playheadFrame={20}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('Glow'));
    const section = screen.getByRole('region', { name: 'Keyframes de Glow' });
    fireEvent.click(within(section).getByRole('button', { name: 'Agregar keyframe' }));
    expect(onKeyframes).toHaveBeenCalledWith([
      { frame: 0, property: 'glowIntensity', value: 0, easing: 'linear' },
      { frame: 20, property: 'glowIntensity', value: 0.2, easing: 'linear' },
    ]);
  });

  it('permite keyframear el grano', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { grain: 0.2 },
      effectKeyframes: [{ frame: 0, property: 'grain', value: 0, easing: 'linear' }],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentClip={currentClip}
        currentEffects={{ grain: 0.2 }}
        playheadFrame={20}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('Grano'));
    const section = screen.getByRole('region', { name: 'Keyframes de Grano' });
    fireEvent.click(within(section).getByRole('button', { name: 'Agregar keyframe' }));
    expect(onKeyframes).toHaveBeenCalledWith([
      { frame: 0, property: 'grain', value: 0, easing: 'linear' },
      { frame: 20, property: 'grain', value: 0.2, easing: 'linear' },
    ]);
  });

  it('permite una curva Bézier personalizada por keyframe', () => {
    const onKeyframes = vi.fn();
    const currentClip = {
      id: 'clip-1',
      kind: 'video',
      trackId: 'track-1',
      startFrame: 0,
      durationFrames: 60,
      source: { type: 'asset', assetId: 'asset-1', inFrame: 0, outFrame: 60 },
      effects: { brightness: 0 },
      effectKeyframes: [
        { frame: 0, property: 'brightness', value: 0, easing: 'linear' },
        { frame: 30, property: 'brightness', value: 1, easing: 'linear' },
      ],
    } as unknown as Clip;
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentClip={currentClip}
        playheadFrame={0}
        onApply={() => {}}
        onKeyframes={onKeyframes}
      />,
    );
    fireEvent.click(screen.getByText('Brillo'));
    const section = screen.getByRole('region', { name: 'Keyframes de Brillo' });
    fireEvent.change(within(section).getByLabelText('Easing 1'), {
      target: { value: 'bezier' },
    });
    const first = onKeyframes.mock.calls.at(-1)?.[0][0];
    expect(first.bezier).toEqual({ cp1X: 0.42, cp1Y: 0, cp2X: 0.58, cp2Y: 1 });
    fireEvent.change(within(section).getByLabelText('cp1X 1'), {
      target: { value: '0.2' },
    });
    const updated = onKeyframes.mock.calls.at(-1)?.[0][0];
    expect(updated.bezier.cp1X).toBeCloseTo(0.2);
  });

  it('guarda, aplica y elimina presets de efectos del usuario', () => {
    const onApplyPreset = vi.fn();
    render(
      <EffectBrowser
        catalog={catalog}
        disabled={false}
        currentEffects={{ brightness: 0.4 }}
        onApply={() => {}}
        onApplyPreset={onApplyPreset}
      />,
    );
    fireEvent.change(screen.getByLabelText('Nombre del preset'), {
      target: { value: 'Cálido' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar preset' }));
    expect(localStorage.getItem('olyvia.effects.presets')).toContain('Cálido');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar Cálido' }));
    expect(onApplyPreset).toHaveBeenCalledWith('Cálido', { brightness: 0.4 });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar Cálido' }));
    expect(screen.getByRole('button', { name: 'Aplicar Cálido (copia)' })).toBeTruthy();
    expect(localStorage.getItem('olyvia.effects.presets')).toContain('Cálido (copia)');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Cálido' }));
    expect(screen.queryByRole('button', { name: 'Aplicar Cálido' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aplicar Cálido (copia)' })).toBeTruthy();
  });

  it('persists favorites and recent effects', () => {
    render(<EffectBrowser catalog={catalog} disabled={false} onApply={() => {}} />);
    fireEvent.click(screen.getByLabelText('Favorito Contraste'));
    expect(localStorage.getItem('olyvia.effects.preferences')).toContain('contrast');
    fireEvent.click(screen.getByText('Brillo'));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar efecto' }));
    expect(screen.getByRole('button', { name: /Reciente: Brillo/ })).toBeTruthy();
  });
});
