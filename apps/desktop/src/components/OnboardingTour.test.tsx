// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_STEPS } from '../app/workspace-map';
import { OnboardingTour, TOUR_COMPLETED_KEY, TOUR_STEPS } from './OnboardingTour';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('OnboardingTour · recorrido único', () => {
  it('deriva sus pasos de WORKSPACE_STEPS: mismos ids, títulos y textos', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(WORKSPACE_STEPS.map((step) => step.id));
    expect(TOUR_STEPS).toHaveLength(WORKSPACE_STEPS.length);
    TOUR_STEPS.forEach((step, index) => {
      const source = WORKSPACE_STEPS[index]!;
      expect(step.title).toBe(source.label);
      expect(step.subtitle).toBe(source.action);
      expect(step.content).toBe(source.detail);
      expect(step.proTip).toBe(source.tip);
      expect(step.view).toBe(source.view);
    });
  });

  it('muestra el primer paso canónico y navega a la vista de cada etapa', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<OnboardingTour open onClose={onClose} onNavigate={onNavigate} currentView="home" />);

    expect(screen.getByText('Paso 1 de 6')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Proyecto' })).toBeTruthy();
    expect(screen.getByText(WORKSPACE_STEPS[0]!.detail)).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(onNavigate).toHaveBeenCalledWith('projects');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('heading', { name: 'Guion' })).toBeTruthy();
    expect(onNavigate).toHaveBeenCalledWith('script');
  });

  it('al terminar marca el tour como completado y avisa el cierre', () => {
    const onClose = vi.fn();
    render(<OnboardingTour open onClose={onClose} onNavigate={() => {}} currentView="editor" />);

    for (let index = 0; index < TOUR_STEPS.length - 1; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    }
    fireEvent.click(screen.getByRole('button', { name: '¡Empezar a editar!' }));

    expect(window.localStorage.getItem(TOUR_COMPLETED_KEY)).toBe('true');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
