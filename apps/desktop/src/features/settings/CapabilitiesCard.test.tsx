// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CapabilityInfo } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { CapabilitiesCard } from './CapabilitiesCard';

afterEach(cleanup);

function serviceWithCapabilities(capabilities: readonly CapabilityInfo[]) {
  const service = createFakeService();
  service.listCapabilities = async () => [...capabilities];
  service.listModels = async () => [];
  return service;
}

const TRANSCRIBE_MISSING: CapabilityInfo = {
  id: 'transcribe',
  label: 'Transcribir audio y video',
  purpose: 'Pasa la voz a texto con subtítulos por palabra, todo local.',
  available: false,
  backends: [
    {
      id: 'faster-whisper',
      kind: 'local',
      detail: 'Python del equipo con faster-whisper (el motor no viene empaquetado)',
      available: false,
      reason:
        'el Python de PATH (python) no tiene faster-whisper; instalá el motor con `python -m pip install faster-whisper` y reiniciá Olyvia',
    },
  ],
};

function renderCard(service: ReturnType<typeof createFakeService>) {
  render(
    <ProjectProvider service={service}>
      <CapabilitiesCard />
    </ProjectProvider>,
  );
}

describe('tarjeta de capacidades', () => {
  it('muestra la transcripción no disponible con el motivo accionable del backend', async () => {
    renderCard(serviceWithCapabilities([TRANSCRIBE_MISSING]));
    expect(await screen.findByText('Transcribir audio y video')).toBeTruthy();
    const card = screen.getByRole('region', { name: /qué puede hacer tu equipo/i });
    const text = card.textContent ?? '';
    expect(text).toContain('el motor no viene empaquetado');
    expect(text).toContain('no disponible');
    expect(text).toContain('python -m pip install faster-whisper');
    // El copy viejo afirmaba que Whisper venía empaquetado con la app.
    expect(text).not.toContain('Faster-Whisper empaquetado con la app');
  });

  it('muestra una capacidad disponible como lista', async () => {
    const available: CapabilityInfo = {
      ...TRANSCRIBE_MISSING,
      available: true,
      backends: [
        {
          id: 'faster-whisper',
          kind: 'local',
          detail: 'Python verificado con faster-whisper en el equipo (python.exe)',
          available: true,
          reason: null,
        },
      ],
    };
    renderCard(serviceWithCapabilities([available]));
    expect(await screen.findByText('Transcribir audio y video')).toBeTruthy();
    const card = screen.getByRole('region', { name: /qué puede hacer tu equipo/i });
    expect(card.textContent).toContain('Python verificado con faster-whisper');
    expect(card.textContent).toContain('listo');
    expect(card.textContent).not.toContain('no disponible');
  });
});
