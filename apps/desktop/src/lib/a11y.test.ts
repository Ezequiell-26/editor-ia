import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { onKeyboardActivate } from './a11y';

function keyEvent(key: string, sameTarget = true): KeyboardEvent<HTMLElement> {
  const currentTarget = {} as HTMLElement;
  const event = {
    key,
    currentTarget,
    target: sameTarget ? currentTarget : ({} as HTMLElement),
    preventDefault: vi.fn(),
  };
  return event as unknown as KeyboardEvent<HTMLElement>;
}

describe('activación por teclado de superficies no nativas', () => {
  it('Enter y Espacio ejecutan la acción y cancelan el scroll', () => {
    const activate = vi.fn();
    for (const key of ['Enter', ' ', 'Spacebar']) {
      const event = keyEvent(key);
      onKeyboardActivate(event, activate);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(activate).toHaveBeenCalledTimes(3);
  });

  it('otras teclas no disparan la acción', () => {
    const activate = vi.fn();
    onKeyboardActivate(keyEvent('ArrowDown'), activate);
    onKeyboardActivate(keyEvent('Escape'), activate);
    expect(activate).not.toHaveBeenCalled();
  });

  it('un botón anidado no dispara dos veces la misma acción', () => {
    const activate = vi.fn();
    onKeyboardActivate(keyEvent('Enter', false), activate);
    expect(activate).not.toHaveBeenCalled();
  });
});
