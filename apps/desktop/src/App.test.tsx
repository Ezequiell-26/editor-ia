// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { NAV_VIEWS } from './app/navigation';

const stylesRoot = join(dirname(fileURLToPath(import.meta.url)), 'styles');

function readStyle(name: string): string {
  return readFileSync(join(stylesRoot, name), 'utf8');
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((index) =>
    channel(Number.parseInt(digits.slice(index, index + 2), 16)),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const high = luminance(foreground);
  const low = luminance(background);
  return (high + 0.05) / (low + 0.05);
}

function token(tokens: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
  expect(match, `falta el token CSS ${name}`).not.toBeNull();
  return (match?.[1] ?? '').trim();
}

function goTo(label: string): HTMLElement {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: label }));
  return screen.getByRole('main');
}

afterEach(cleanup);

describe('shell de escritorio', () => {
  it('anuncia el titulo y las cuatro vistas como navegacion principal', () => {
    render(<App />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('heading', { level: 1, name: /Editor IA/ })).toBeTruthy();
    expect(banner.textContent).toMatch(/no disponibles/i);
    const nav = screen.getByRole('navigation', { name: /vistas/i });
    expect(
      [...nav.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).toEqual(NAV_VIEWS.map((view) => view.label));
    expect(
      within(nav)
        .getByRole('button', { name: NAV_VIEWS[0]?.label ?? '' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('arranca en Projects con lista vacia de verdad, sin filas de relleno', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 2, name: /Projects/i })).toBeTruthy();
    expect(main.textContent).toMatch(/no hay proyectos/i);
    expect(within(main).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('la vista Editor muestra timeline, preview e inspector explicitamente vacios', () => {
    render(<App />);
    const main = goTo('Editor');
    expect(main.textContent).toMatch(/timeline (vacía|vacia)/i);
    for (const panel of ['preview', 'inspector']) {
      expect(main.textContent, `falta el panel ${panel}`).toMatch(new RegExp(panel, 'i'));
    }
    expect(main.textContent).toMatch(/no está disponible|no esta disponible|no hay/i);
  });

  it('Assets y Settings declaran que no tienen contenido ni preferencias operativas', () => {
    render(<App />);
    expect(goTo('Assets').textContent).toMatch(/no hay assets/i);
    cleanup();
    render(<App />);
    expect(goTo('Settings').textContent).toMatch(/ninguna.*(configuraci|preferencia)/i);
  });

  it('Editor, Assets y Settings siguen sin ofrecer controles que no hacen nada', () => {
    render(<App />);
    for (const label of ['Editor', 'Assets', 'Settings']) {
      const content = goTo(label);
      expect(
        within(content).queryAllByRole('button'),
        `la vista ${label} tiene botones que no hacen nada`,
      ).toHaveLength(0);
      expect(within(content).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(content).queryAllByRole('combobox')).toHaveLength(0);
      expect(
        content.textContent ?? '',
        `la vista ${label} anuncia un render listo`,
      ).not.toMatch(/render\w*[^.]*\blisto\b/i);
    }
  });

  it('Projects no habilita ningun control mientras el borde nativo no exista', () => {
    render(<App />);
    const content = screen.getByRole('main');
    const buttons = within(content).queryAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(
        (button as HTMLButtonElement).disabled,
        `${button.textContent ?? ''} estaria habilitado sin hacer nada`,
      ).toBe(true);
    }
    expect(content.textContent ?? '').toMatch(/tarea 4/i);
  });

  it('el color de texto tenue solo se usa en controles inhabilitados', () => {
    const app = readStyle('app.css');
    const rules = app.split('}');
    const offenders = rules
      .filter((rule) => rule.includes('var(--color-empty)'))
      .filter((rule) => !rule.includes(':disabled'))
      .map((rule) => (rule.split('{')[0] ?? '').trim());
    expect(
      offenders,
      `--color-empty esta por debajo de AA como texto real: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('los tokens de color pasan el contraste WCAG AA sobre el fondo', () => {
    const tokens = readStyle('tokens.css');
    const background = token(tokens, '--color-bg');
    expect(contrastRatio(token(tokens, '--color-text'), background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(token(tokens, '--color-text-muted'), background)).toBeGreaterThanOrEqual(4.5);
  });

  it('el layout escala a 1280x720 sin imponer un minimo mas ancho que esa ventana', () => {
    const app = readStyle('app.css');
    expect(app).toMatch(/grid-template-columns:[^;]*minmax\(/);
    expect(app).toMatch(/@media[^{]*max-width:\s*1280px/);
    const tooWide = [...app.matchAll(/min-width:\s*(\d+)px/g)].filter((m) => Number(m[1]) > 1280);
    expect(tooWide, `min-width mayor a 1280px: ${tooWide.map((m) => m[1]).join(', ')}`).toHaveLength(0);
    const tokens = readStyle('tokens.css');
    expect(Number.parseInt(token(tokens, '--text-base'), 10)).toBeGreaterThanOrEqual(14);
    expect(Number.parseFloat(token(tokens, '--leading'))).toBeGreaterThanOrEqual(1.4);
  });
});
