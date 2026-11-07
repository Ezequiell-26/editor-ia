// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ClipEffects } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../../state/project-store';
import { addAsset, addClipFromAsset } from '../../../state/project-actions';
import { createFakeService, readyAsset } from '../../../test/fake-service';
import { compileGrade, gradeFilterId } from '../../color/color-engine';
import { GRADE_PRESETS_KEY } from '../../color/grade-presets';
import { ColorPropertiesPanel, type PropertiesMode } from './ColorPropertiesPanel';

const NOW = '2026-11-07T00:00:00.000Z';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function makeProject() {
  const base = createEmptyProject('Propiedades', NOW);
  const asset = readyAsset();
  const result = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 120,
  });
  return { project: result.project, clipId: result.clipId };
}

/** Lee el MISMO store que el panel: si un control no persiste, el test falla. */
function StoreProbe({ clipId }: { readonly clipId: string }) {
  const store = useProjectStore();
  const clip = store.state.project?.timeline.clips.find((item) => item.id === clipId);
  const effects = clip && 'effects' in clip ? (clip.effects as ClipEffects | undefined) : undefined;
  const grade = effects?.colorGrade;
  const layer = grade?.nodes.find((node) => node.id === grade.activeNodeId)?.layer;
  const projection = compileGrade(grade, gradeFilterId(clipId)).effects;
  return (
    <div
      data-testid="probe"
      data-temperature={layer?.primaries.temperature ?? 'none'}
      data-saturation={layer?.primaries.saturation ?? 'none'}
      data-look={layer?.lookId ?? 'none'}
      data-wheel-x={layer?.hdrWheels?.black.x ?? 'none'}
      data-keyed={(layer?.keyed ?? []).join(',')}
      data-effects={JSON.stringify(projection)}
    />
  );
}

function renderPanel(mode: PropertiesMode, subTab: string) {
  const { project, clipId } = makeProject();
  const service = createFakeService();
  const view = render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: { project, label: 'test.editoria.json', path: 'C:\\test\\test.editoria.json', root: 'C:\\test' },
      }}
    >
      <ColorPropertiesPanel clipId={clipId} mode={mode} subTab={subTab} />
      <StoreProbe clipId={clipId} />
    </ProjectProvider>,
  );
  return { ...view, clipId };
}

describe('ColorPropertiesPanel · capturas 118 / 127', () => {
  it('Básico: el slider de Temperatura persiste y se proyecta al export', () => {
    renderPanel('color', 'basic');
    const probe = screen.getByTestId('probe');
    // Un proyecto nuevo no materializa colorGrade hasta el primer cambio.
    expect(probe.getAttribute('data-temperature')).toBe('none');

    fireEvent.change(screen.getByLabelText('Temperatura'), { target: { value: '50' } });
    expect(probe.getAttribute('data-temperature')).toBe('0.5');

    const effects = JSON.parse(probe.getAttribute('data-effects') ?? '{}') as { temperature?: number };
    expect(effects.temperature).toBeCloseTo(0.5, 2);
  });

  it('Básico: el diamante de keyframe persiste la marca en el proyecto', () => {
    renderPanel('color', 'basic');
    const probe = screen.getByTestId('probe');
    fireEvent.click(screen.getByLabelText('Agregar marca de animación en Temperatura'));
    expect(probe.getAttribute('data-keyed')).toContain('temperature');
  });

  it('Estilo: aplicar «Blanco y negro» cambia saturación y guarda el look', () => {
    renderPanel('color', 'basic');
    const probe = screen.getByTestId('probe');
    fireEvent.click(screen.getByTitle('Blanco y negro'));
    expect(probe.getAttribute('data-saturation')).toBe('0');
    expect(probe.getAttribute('data-look')).toBe('mono');
  });

  it('HDR: el campo X de la rueda «Negro» persiste y afecta la proyección', () => {
    renderPanel('mask', 'hdr');
    const probe = screen.getByTestId('probe');
    fireEvent.change(screen.getByLabelText('Negro X'), { target: { value: '0,50' } });
    expect(probe.getAttribute('data-wheel-x')).toBe('0.5');
    const effects = JSON.parse(probe.getAttribute('data-effects') ?? '{}') as {
      lift?: { r: number; g: number; b: number };
    };
    expect(effects.lift?.b).toBeGreaterThan(0);
  });

  it('Restablecer devuelve la capa a neutro', () => {
    renderPanel('color', 'basic');
    const probe = screen.getByTestId('probe');
    fireEvent.change(screen.getByLabelText('Temperatura'), { target: { value: '80' } });
    expect(probe.getAttribute('data-temperature')).toBe('0.8');
    fireEvent.click(screen.getByTitle('Volver todos los valores de esta capa a neutro'));
    expect(probe.getAttribute('data-temperature')).toBe('0');
  });

  it('Guardar como personalizado crea un look recuperable', () => {
    renderPanel('color', 'basic');
    fireEvent.change(screen.getByLabelText('Temperatura'), { target: { value: '40' } });
    fireEvent.click(screen.getByTitle('Guardar el ajuste actual como look personalizado'));
    const raw = window.localStorage.getItem(GRADE_PRESETS_KEY) ?? '';
    expect(raw).toContain('Personalizado');
    expect(screen.getAllByRole('status').map((el) => el.textContent).join(' ')).toMatch(/guardado/i);
  });

  it('Máscara de color ofrece capas reales', () => {
    renderPanel('mask', 'layers');
    expect(screen.getByText('Capas de gradación')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Añadir capa de gradación de color/i })).toBeTruthy();
  });
});
