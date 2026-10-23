// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { BackupCard } from './BackupCard';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderCard() {
  return render(
    <AppearanceProvider>
      <BackupCard />
    </AppearanceProvider>,
  );
}

describe('tarjeta de respaldo', () => {
  it('ofrece descargar, restaurar y restablecer', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Descargar respaldo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restaurar desde archivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restablecer de fábrica' })).toBeTruthy();
  });

  it('pide confirmación antes de restablecer todo', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer de fábrica' }));

    const confirm = screen.getByRole('button', { name: 'Confirmar restablecer de fábrica' });
    expect(confirm).toBeTruthy();
    expect(screen.queryByText(/volvieron a los valores de fábrica/)).toBeNull();

    fireEvent.click(confirm);
    expect(screen.getByText(/volvieron a los valores de fábrica/)).toBeTruthy();
  });
});
