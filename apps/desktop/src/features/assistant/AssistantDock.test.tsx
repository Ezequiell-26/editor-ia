// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createFakeService } from '../../test/fake-service';

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
