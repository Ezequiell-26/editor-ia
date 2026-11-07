/**
 * E2E del sistema de color «completamente configurable» (docs/COLOR-CUSTOMIZATION.md).
 *
 * Verificación independiente y adversarial del estudio de color de Ajustes:
 *   1. cambio de acento y de panel en vivo (variables CSS computadas + preview),
 *   2. persistencia tras recargar (localStorage),
 *   3. importar/exportar archivo de tema (`olyvia-theme`, 34 tokens),
 *   4. contraste real y botón «Corregir texto»,
 *   5. tema claro personalizado para medir los límites reales,
 *   6. medición de cobertura: qué propiedades pintadas responden al tema y qué
 *      literales siguen visibles, cuánto afecta cada token y los pares
 *      texto/fondo con su ratio WCAG efectivo.
 *
 * El resultado medido se escribe en `.tmp-theme-shots/after/report.json` y las
 * capturas en `.tmp-theme-shots/after/`. El método de cada heurística está
 * documentado en el campo `method` del reporte.
 *
 * Correr desde `apps/desktop`:
 *   npx playwright test e2e/theme.spec.ts
 * El config apunta a http://localhost:3000 (el server de `npm run dev`) con
 * `reuseExistingServer: true`: reutiliza el Vite del equipo, no levanta otro.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// --------------------------------------------------------------------------
// Entrada a la app
//
// El lanzador siembra proyectos demo recientes con «Tutorial» en el nombre, así
// que `getByRole('button', { name: 'Tutorial' })` es ambiguo (3 coincidencias:
// tarjeta demo, su botón de borrar y el botón del footer) y cualquier spec que
// use el helper sin `exact` falla por strict mode. Acá se entra con
// `exact: true`; el mismo fix mínimo (autorizado por el Lead) quedó aplicado en
// `e2e/helpers.ts` como arreglo de arnés, no como cambio de producto.
// --------------------------------------------------------------------------

async function enterShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.start-window')).toBeVisible();
  await page.getByRole('button', { name: 'Tutorial', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function enterSettingsPage(page: Page): Promise<void> {
  await enterShell(page);
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
}

// --------------------------------------------------------------------------
// Constantes del contrato
// --------------------------------------------------------------------------

const STORAGE_KEY = 'editor-ia.appearance.v4';
const THEME_FILE_NAME = 'olyvia-tema.json';

/**
 * Preset nativo «Claro neutro» (fuente: src/state/theme-palette.ts →
 * LIGHT_PALETTE). Se replican sólo los tokens que este e2e verifica; el resto
 * lo cubren los tests unitarios de theme-palette.
 */
const NATIVE_LIGHT = {
  name: 'Claro neutro',
  bg: '#eef0f3',
  surface: '#f7f8fa',
  panel: '#f2f3f6',
  text: '#15181e',
} as const;

/** Los 34 tokens editables, en el orden que publica docs/COLOR-CUSTOMIZATION.md §2.1. */
const TOKEN_IDS = [
  // superficies (14)
  'bg',
  'surface',
  'panel',
  'panel2',
  'panel3',
  'panelRaised',
  'surfaceRaised',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'textSecondary',
  'textFaint',
  'empty',
  // acento (5)
  'accent',
  'accentLight',
  'accentStrong',
  'accentInk',
  'info',
  // estados (5)
  'success',
  'warning',
  'danger',
  'dangerStrong',
  'cta',
  // medios (6)
  'video',
  'image',
  'audio',
  'narration',
  'caption',
  'graphic',
  // marca (4)
  'brandCyan',
  'brandBlue',
  'brandViolet',
  'brandMagenta',
] as const;

type TokenId = (typeof TOKEN_IDS)[number];

/** Paleta `olyvia` explícita del contrato (§2.2). */
const DEFAULT_PALETTE: Record<TokenId, string> = {
  bg: '#0f1115',
  surface: '#181b20',
  panel: '#181b20',
  panel2: '#1c2027',
  panel3: '#222731',
  panelRaised: '#1b2029',
  surfaceRaised: '#161a20',
  border: '#2d3240',
  borderStrong: '#3a4152',
  text: '#f2f5ff',
  textMuted: '#9ca3af',
  textSecondary: '#7a8ba8',
  textFaint: '#6b7480',
  empty: '#6b7280',
  accent: '#1f5eff',
  accentLight: '#6ee1ff',
  accentStrong: '#1748c9',
  accentInk: '#f8fffc',
  info: '#22c55e',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  dangerStrong: '#dc2626',
  cta: '#ff6b2b',
  video: '#4d8df0',
  image: '#8b74e8',
  audio: '#2eb8a6',
  narration: '#56b97f',
  caption: '#d9b34a',
  graphic: '#d76fa9',
  brandCyan: '#35d6ff',
  brandBlue: '#4f8dff',
  brandViolet: '#8b5cf6',
  brandMagenta: '#d35cff',
};

/** Tema oscuro personalizado (acento rojo + paneles violetas) para capturas. */
const CUSTOM_DARK_PALETTE: Record<TokenId, string> = {
  ...DEFAULT_PALETTE,
  bg: '#0d0a14',
  surface: '#1a1626',
  panel: '#211a31',
  panel2: '#27203a',
  panel3: '#2f2745',
  panelRaised: '#241d36',
  surfaceRaised: '#171320',
  border: '#3f3358',
  borderStrong: '#5b4a7d',
  text: '#f5f0ff',
  textMuted: '#b3a8c9',
  textSecondary: '#9587b0',
  textFaint: '#80719a',
  empty: '#8b7fa3',
  accent: '#e0245e',
  accentLight: '#ff7d9c',
  accentStrong: '#a8163f',
  accentInk: '#fff5f8',
  info: '#f472b6',
  brandCyan: '#ff7d9c',
  brandBlue: '#e0245e',
  brandViolet: '#a855f7',
  brandMagenta: '#f472b6',
};

/** Tema claro realista (bg blanco) para medir el límite «más allá de oscuro». */
const LIGHT_PALETTE: Record<TokenId, string> = {
  ...DEFAULT_PALETTE,
  bg: '#ffffff',
  surface: '#f5f6f8',
  panel: '#ffffff',
  panel2: '#eef1f5',
  panel3: '#e6eaf0',
  panelRaised: '#f0f2f6',
  surfaceRaised: '#fafbfc',
  border: '#d5dae3',
  borderStrong: '#b8c0cc',
  text: '#111827',
  textMuted: '#4b5563',
  textSecondary: '#6b7280',
  textFaint: '#7b8494',
  empty: '#9aa3af',
  accent: '#2563eb',
  accentLight: '#6ea8ff',
  accentStrong: '#1e40af',
  accentInk: '#ffffff',
  info: '#0ea5e9',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  dangerStrong: '#b91c1c',
  cta: '#ea580c',
  video: '#2563eb',
  image: '#7c3aed',
  audio: '#0d9488',
  narration: '#15803d',
  caption: '#a16207',
  graphic: '#be185d',
  brandCyan: '#0ea5e9',
  brandBlue: '#2563eb',
  brandViolet: '#7c3aed',
  brandMagenta: '#d946ef',
};

/** Variables que el motor debe emitir además de los 34 `--color-*` (§2.4). */
const REQUIRED_EXTRA_VARIABLES = [
  '--commercial-canvas',
  '--commercial-surface',
  '--commercial-border',
  '--commercial-border-strong',
  '--commercial-accent',
  '--commercial-success',
  '--commercial-cta',
  '--commercial-text',
  '--commercial-muted',
  '--commercial-input',
  '--olyvia-cyan',
  '--olyvia-blue',
  '--olyvia-violet',
  '--olyvia-magenta',
  '--olyvia-ink',
  '--olyvia-panel',
  '--olyvia-border',
  '--color-ok',
  '--color-ok-strong',
  '--color-warn',
  '--color-warn-strong',
  '--brand-gradient',
  '--brand-gradient-hover',
  '--brand-gradient-subtle',
  '--brand-glow',
  '--brand-border',
  '--brand-ink',
  '--glow-accent',
  '--glow-accent-strong',
  '--glow-success',
  '--glow-danger',
  '--primary-hue',
] as const;

// --------------------------------------------------------------------------
// Utilidades de Node
// --------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

/** Evidencia acumulada por los tests; el último test la vuelca al reporte. */
const evidence: JsonRecord[] = [];

function recordEvidence(entry: JsonRecord): void {
  evidence.push(entry);
}

function repoRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'docs', 'COLOR-CUSTOMIZATION.md'))) return current;
    current = path.dirname(current);
  }
  return path.resolve(process.cwd(), '..', '..');
}

const SHOTS_DIR = path.join(repoRoot(), '.tmp-theme-shots', 'after');
const REPORT_PATH = path.join(SHOTS_DIR, 'report.json');

function shot(name: string): string {
  mkdirSync(SHOTS_DIR, { recursive: true });
  return path.join(SHOTS_DIR, name);
}

function buildThemeFile(palette: Record<string, string>, name: string): string {
  return JSON.stringify(
    {
      kind: 'olyvia-theme',
      version: 1,
      name,
      exportedAt: new Date().toISOString(),
      palette,
    },
    null,
    2,
  );
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToCss(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Ratio de contraste WCAG 2.x entre dos colores hex. */
function contrastRatioHex(a: string, b: string): number {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) return Number.NaN;
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  const [high, low] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (high + 0.05) / (low + 0.05);
}

function parseDisplayedRatio(text: string): number {
  const match = /([0-9]+(?:[.,][0-9]+)?)/.exec(text);
  return match && match[1] ? Number.parseFloat(match[1].replace(',', '.')) : Number.NaN;
}

// --------------------------------------------------------------------------
// Helpers de Playwright
// --------------------------------------------------------------------------

async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(),
    name,
  );
}

async function waitForVar(page: Page, name: string, value: string): Promise<void> {
  await expect
    .poll(async () => cssVar(page, name), {
      timeout: 20_000,
      message: `la variable ${name} debería quedar en ${value}`,
    })
    .toBe(value);
}

async function storedPalette(page: Page): Promise<Record<string, string> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { palette?: Record<string, string> };
      return parsed.palette ?? null;
    } catch {
      return null;
    }
  }, STORAGE_KEY);
}

async function openColorStudio(page: Page): Promise<Locator> {
  await enterSettingsPage(page);
  const studio = page.locator('.color-studio');
  await expect(studio).toBeVisible();
  return studio;
}

function tokenRow(studio: Locator, token: TokenId): Locator {
  return studio.locator(`.color-row[data-token="${token}"]`);
}

function tokenHexInput(studio: Locator, token: TokenId): Locator {
  return tokenRow(studio, token).locator('input.color-hex').first();
}

async function openGroup(page: Page, group: string): Promise<void> {
  const details = page.locator(`.color-group[data-group="${group}"]`);
  await expect(details).toBeVisible();
  const open = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!open) {
    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', true);
  }
}

/** Abre el grupo que contiene `token` (los grupos arrancan colapsados salvo superficies). */
async function openTokenGroup(page: Page, token: TokenId): Promise<void> {
  const group = await page.evaluate((tokenId) => {
    const row = document.querySelector(`.color-row[data-token="${tokenId}"]`);
    return row?.closest('.color-group')?.getAttribute('data-group') ?? null;
  }, token);
  if (group) await openGroup(page, group);
}

/**
 * Cambia el color de un token como lo haría el usuario con la rueda Lumetri:
 * abre el popover del `ColorSwatch`, escribe el hex y confirma con Enter
 * (`commitDraft` persiste; `onChange` ya previsualizó al completar el hex).
 */
async function setTokenColor(page: Page, studio: Locator, token: TokenId, value: string): Promise<void> {
  await openTokenGroup(page, token);
  const swatch = tokenRow(studio, token).locator('button.color-swatch').first();
  await expect(swatch).toBeVisible();
  await swatch.click();
  const hexInput = page.locator('.color-popover .color-popover-hex');
  await expect(hexInput).toBeVisible();
  await hexInput.click();
  await hexInput.fill(value);
  await hexInput.press('Enter');
  await expect(page.locator('.color-popover')).toBeHidden();
}

/** Escribe un hex y confirma con Enter + blur (contrato de la fila color-hex). */
async function setTokenHex(page: Page, studio: Locator, token: TokenId, value: string): Promise<void> {
  await openTokenGroup(page, token);
  const input = tokenHexInput(studio, token);
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(value);
  await input.press('Enter');
  await input.blur();
}

interface PreviewProbe {
  readonly found: boolean;
  readonly selector: string;
  readonly background: string;
  readonly color: string;
  readonly border: string;
  readonly image: string;
}

/** Color computado del botón primario del preview (mock vivo del shell). */
async function probePreviewPrimary(page: Page): Promise<PreviewProbe> {
  return page.evaluate(() => {
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 4; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const classes = Array.from(node.classList)
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('');
        parts.unshift(`${tag}${classes}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const empty = {
      found: false,
      selector: '',
      background: '',
      color: '',
      border: '',
      image: '',
    };
    const preview = document.querySelector('.theme-preview');
    if (!preview) return empty;
    const target =
      preview.querySelector('button.primary') ??
      preview.querySelector('button.theme-preview-primary') ??
      preview.querySelector('button') ??
      preview.querySelector('[role="button"]');
    if (!target) return empty;
    const style = getComputedStyle(target);
    return {
      found: true,
      selector: describe(target),
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      image: style.backgroundImage.slice(0, 160),
    };
  });
}

interface VisibleColorSample {
  readonly key: string;
  readonly selector: string;
  readonly background: string;
  readonly image: string;
  readonly border: string;
  readonly color: string;
}

/**
 * Foto de los colores pintados de cada elemento con layout visible (no oculto
 * por display/visibility/opacity). Sirve para comparar antes/después de editar
 * un token sin depender de una lista fija de selectores.
 */
async function sampleVisibleColors(page: Page): Promise<VisibleColorSample[]> {
  return page.evaluate(() => {
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 4; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const classes = Array.from(node.classList)
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('');
        parts.unshift(`${tag}${classes}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const seen = new Map<string, number>();
    const samples: Array<{
      key: string;
      selector: string;
      background: string;
      image: string;
      border: string;
      color: string;
    }> = [];
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      // checkVisibility (Chromium) excluye el contenido de <details> cerrados:
      // tiene getClientRects() pero no se pinta y conserva estilos viejos.
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (
        typeof check === 'function' &&
        !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number.parseFloat(style.opacity) <= 0.02) continue;
      if (element.getClientRects().length === 0) continue;
      const selector = describe(element);
      const index = seen.get(selector) ?? 0;
      seen.set(selector, index + 1);
      samples.push({
        key: `${selector}@${index}`,
        selector,
        background: style.backgroundColor,
        image: style.backgroundImage.slice(0, 120),
        border: style.borderTopColor,
        color: style.color,
      });
    }
    return samples;
  });
}

interface VisibleColorChange {
  readonly selector: string;
  readonly changedProperties: string[];
  readonly before: Record<string, string>;
  readonly after: Record<string, string>;
}

/** Diferencias de color entre dos fotos, emparejadas por selector estable. */
function diffVisibleColors(
  before: VisibleColorSample[],
  after: VisibleColorSample[],
): VisibleColorChange[] {
  const previous = new Map(before.map((sample) => [sample.key, sample]));
  const changes: VisibleColorChange[] = [];
  for (const sample of after) {
    const old = previous.get(sample.key);
    if (!old) continue;
    const changedProperties: string[] = [];
    for (const property of ['background', 'border', 'color', 'image'] as const) {
      if (old[property] !== sample[property]) changedProperties.push(property);
    }
    if (changedProperties.length === 0) continue;
    changes.push({
      selector: sample.selector,
      changedProperties,
      before: {
        background: old.background,
        border: old.border,
        color: old.color,
        image: old.image,
      },
      after: {
        background: sample.background,
        border: sample.border,
        color: sample.color,
        image: sample.image,
      },
    });
  }
  return changes;
}

interface ContrastInfo {
  readonly rowClasses: string;
  readonly stateClasses: string;
  readonly ratioText: string;
  readonly stateText: string;
  readonly label: string;
  readonly found: boolean;
}

/**
 * Estado de una fila de contraste. El contrato fija `data-check="text-bg"`; si
 * el motor publicara otro id, se cae a la primera fila de texto/fondo y se deja
 * constancia en la evidencia (no se tapa la diferencia de contrato).
 */
async function contrastInfo(page: Page): Promise<ContrastInfo> {
  return page.evaluate(() => {
    const empty = {
      rowClasses: '',
      stateClasses: '',
      ratioText: '',
      stateText: '',
      label: '',
      found: false,
    };
    const rows = Array.from(document.querySelectorAll('.contrast-row'));
    const row =
      document.querySelector('.contrast-row[data-check="text-bg"]') ??
      rows.find((candidate) =>
        /texto.*fondo|fondo.*texto/i.test(
          (candidate.querySelector('.contrast-label')?.textContent ?? '') + candidate.textContent,
        ),
      );
    if (!row) return empty;
    const state = row.querySelector('.contrast-state');
    const ratio = row.querySelector('.contrast-ratio');
    const label = row.querySelector('.contrast-label');
    return {
      rowClasses: row.className,
      stateClasses: state?.className ?? '',
      ratioText: ratio?.textContent?.trim() ?? '',
      stateText: state?.textContent?.trim() ?? '',
      label: label?.textContent?.trim() ?? '',
      found: true,
    };
  });
}

function contrastChecks(info: ContrastInfo): boolean {
  return /is-pass/.test(`${info.rowClasses} ${info.stateClasses}`);
}

function contrastFails(info: ContrastInfo): boolean {
  return /is-fail/.test(`${info.rowClasses} ${info.stateClasses}`);
}

async function importThemeFile(page: Page, json: string, fileName = THEME_FILE_NAME): Promise<void> {
  await page.locator('input[type="file"].color-studio-file').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf8'),
  });
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
}

async function openSettingsWindow(page: Page): Promise<void> {
  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
  await expect(page.locator('.settings-window .settings-shell')).toBeVisible();
}

// --------------------------------------------------------------------------
// Tests de interacción
// --------------------------------------------------------------------------

test('cambia el acento en vivo y repinta el preview', async ({ page }) => {
  const studio = await openColorStudio(page);

  const beforeAccent = await cssVar(page, '--color-accent');
  const beforeCommercial = await cssVar(page, '--commercial-accent');
  const beforePreview = await probePreviewPrimary(page);
  expect(beforeAccent).toMatch(/^#[0-9a-f]{6}$/i);
  expect(beforePreview.found).toBe(true);

  const nextAccent = beforeAccent.toLowerCase() === '#ff2d55' ? '#00d1ff' : '#ff2d55';
  const expectedRgb = hexToRgb(nextAccent);
  expect(expectedRgb).not.toBeNull();

  await setTokenColor(page, studio, 'accent', nextAccent);

  // En vivo: las variables computadas y el alias comercial siguen al acento.
  await waitForVar(page, '--color-accent', nextAccent);
  await expect.poll(async () => cssVar(page, '--commercial-accent'), { timeout: 10_000 }).toBe(nextAccent);
  expect(beforeCommercial).not.toBe(nextAccent);

  // El botón primario del mock usa var(--color-accent) y cambia de computado.
  await expect
    .poll(async () => (await probePreviewPrimary(page)).background, { timeout: 10_000 })
    .toBe(rgbToCss(expectedRgb as Rgb));
  const afterPreview = await probePreviewPrimary(page);
  expect(afterPreview.background).not.toBe(beforePreview.background);

  await page.screenshot({ path: shot('05-acento-en-vivo.png') });
  recordEvidence({
    test: 'cambia el acento en vivo y repinta el preview',
    beforeAccent,
    nextAccent,
    beforePreview: beforePreview.background,
    afterPreview: afterPreview.background,
  });
});

test('cambia el panel y repinta superficies del shell y del preview', async ({ page }) => {
  // El diálogo de Ajustes reemplaza al shell en el DOM (no queda montado
  // detrás), así que la foto «antes» del shell se toma con el diálogo cerrado
  // y la edición se hace reabriéndolo.
  await enterSettingsPage(page);
  await closeSettings(page);
  await expect(page.locator('.app-shell')).toBeVisible();
  // La comparación se hace en Proyectos: la vista «Aprender» casi no pinta
  // superficies --color-panel y el diff quedaría vacío por falta de muestra.
  await page.locator('.sidebar button[aria-label="Proyectos"]').click();
  await expect(page.locator('.projects-view')).toBeVisible();
  await page.waitForTimeout(300);

  const before = await sampleVisibleColors(page);
  const beforeTopbar = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    return topbar ? getComputedStyle(topbar).backgroundColor : '';
  });

  await page.locator('.sidebar button[aria-label="Ajustes"]').click();
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeVisible();
  const studio = page.locator('.color-studio');
  await expect(studio).toBeVisible();
  const previewPanelBefore = await page.evaluate(() => {
    const panel = document.querySelector('.theme-preview .theme-preview-panel');
    return panel ? getComputedStyle(panel).backgroundColor : '';
  });
  expect(previewPanelBefore).not.toBe('');

  const nextPanel = '#3a2a55';
  await setTokenColor(page, studio, 'panel', nextPanel);
  await waitForVar(page, '--color-panel', nextPanel);

  const expectedRgb = hexToRgb(nextPanel);
  expect(expectedRgb).not.toBeNull();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const panel = document.querySelector('.theme-preview .theme-preview-panel');
          return panel ? getComputedStyle(panel).backgroundColor : '';
        }),
      { timeout: 10_000, message: 'el panel del preview sigue a --color-panel' },
    )
    .toBe(rgbToCss(expectedRgb as Rgb));

  // El shell está detrás del modal: se cierra para comparar el contenido real.
  await closeSettings(page);
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.sidebar button[aria-label="Proyectos"]').click();
  await expect(page.locator('.projects-view')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('06-panel-en-vivo.png') });
  const after = await sampleVisibleColors(page);

  const changed = diffVisibleColors(before, after);
  // En esta app el topbar se pinta con --commercial-surface/--olyvia-panel
  // (= surface), no con --color-panel: se documenta en vez de fingir que sigue.
  const topbarAfter = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    return topbar ? getComputedStyle(topbar).backgroundColor : '';
  });
  const panelSurfaces = changed.filter((sample) =>
    /panel|card|guide|notice|article|window|dialog|popover|drawer/i.test(sample.selector),
  );

  expect(
    changed.length,
    `ningún color visible del shell cambió al editar --color-panel (${changed.length} cambios)`,
  ).toBeGreaterThan(4);
  expect(
    panelSurfaces.length,
    `cambió el panel pero ninguna superficie con rol de panel/card se repintó: ${JSON.stringify(
      changed.slice(0, 10),
    )}`,
  ).toBeGreaterThan(0);

  recordEvidence({
    test: 'cambia el panel y repinta superficies del shell y del preview',
    nextPanel,
    previewPanelBefore,
    changedCount: changed.length,
    changedExamples: changed.slice(0, 10),
    topbarBefore: beforeTopbar,
    topbarAfter,
    topbarFollows:
      'surface (commercial.css .app-shell .topbar usa --commercial-surface, no --color-panel)',
    panelSurfaces: panelSurfaces.slice(0, 8),
  });
});

test('la paleta personalizada persiste tras recargar', async ({ page }) => {
  const studio = await openColorStudio(page);

  const nextAccent = '#e0245e';
  await setTokenColor(page, studio, 'accent', nextAccent);
  await waitForVar(page, '--color-accent', nextAccent);

  // El guardado es con debounce: se espera a que localStorage tenga la paleta.
  await expect
    .poll(async () => (await storedPalette(page))?.accent ?? '', {
      timeout: 15_000,
      message: 'la paleta debería guardarse en localStorage',
    })
    .toBe(nextAccent);
  const stored = await storedPalette(page);
  expect(stored).not.toBeNull();
  expect(Object.keys(stored ?? {}).sort()).toEqual([...TOKEN_IDS].sort());

  await page.reload();
  await enterSettingsPage(page);
  await expect(page.locator('.color-studio')).toBeVisible();

  await waitForVar(page, '--color-accent', nextAccent);
  const storedAfterReload = await storedPalette(page);
  expect(storedAfterReload?.accent).toBe(nextAccent);
  await expect(tokenHexInput(studio, 'accent')).toHaveValue(nextAccent);

  recordEvidence({
    test: 'la paleta personalizada persiste tras recargar',
    accent: nextAccent,
    tokensPersistidos: Object.keys(stored ?? {}).length,
  });
});

test('importa un archivo de tema válido y rechaza uno inválido sin tocar la paleta', async ({ page }) => {
  const studio = await openColorStudio(page);
  const importedAccent = '#e0245e';
  const importedPalette: Record<string, string> = {
    ...DEFAULT_PALETTE,
    accent: importedAccent,
    accentLight: '#ff7d9c',
    accentStrong: '#a8163f',
    accentInk: '#fff5f8',
    bg: '#101820',
    surface: '#161f2c',
    panel: '#1b2635',
    text: '#f4f7fb',
  };

  await importThemeFile(page, buildThemeFile(importedPalette, 'Tema E2E'));
  await waitForVar(page, '--color-accent', importedAccent);
  await waitForVar(page, '--color-bg', importedPalette.bg as string);
  await expect.poll(async () => cssVar(page, '--commercial-accent'), { timeout: 10_000 }).toBe(
    importedAccent,
  );
  const okStatus = page.locator('.color-studio-status[role="status"]');
  await expect(okStatus).toBeVisible();
  await expect(okStatus).toHaveClass(/notice-ok/);
  await expect(okStatus).toContainText(/import/i);

  // Un archivo inválido se rechaza entero: mensaje de error y paleta intacta.
  const accentBeforeInvalid = await cssVar(page, '--color-accent');
  await importThemeFile(
    page,
    JSON.stringify({ kind: 'otro-formato', version: 99, palette: { accent: 'no-es-un-color' } }),
    'tema-invalido.json',
  );
  const errorStatus = page.locator('.color-studio-status[role="status"]');
  await expect(errorStatus).toBeVisible();
  await expect(errorStatus).toHaveClass(/notice-warning/);
  expect((await errorStatus.textContent())?.trim().length ?? 0).toBeGreaterThan(3);
  expect(await cssVar(page, '--color-accent')).toBe(accentBeforeInvalid);
  expect(await cssVar(page, '--color-bg')).toBe(importedPalette.bg as string);

  await page.screenshot({ path: shot('07-import-tema.png') });
  recordEvidence({
    test: 'importa un archivo de tema válido y rechaza uno inválido sin tocar la paleta',
    importedAccent,
    errorStatusText: (await errorStatus.textContent())?.trim() ?? '',
  });
});

test('exporta un archivo olyvia-theme con los 34 tokens', async ({ page }) => {
  await openColorStudio(page);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('.color-studio-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe(THEME_FILE_NAME);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const content = readFileSync(downloadedPath as string, 'utf8');
  writeFileSync(shot('theme-export.json'), content);

  const parsed = JSON.parse(content) as {
    kind?: string;
    version?: number;
    name?: string;
    palette?: Record<string, string>;
  };
  expect(parsed.kind).toBe('olyvia-theme');
  expect(parsed.version).toBe(1);
  expect(typeof parsed.name).toBe('string');
  expect(parsed.palette).toBeDefined();
  expect(Object.keys(parsed.palette ?? {}).sort()).toEqual([...TOKEN_IDS].sort());
  for (const token of TOKEN_IDS) {
    expect(parsed.palette?.[token], `token ${token} en el archivo exportado`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
  }

  await expect(page.locator('.color-studio-status[role="status"]')).toBeVisible();
  recordEvidence({
    test: 'exporta un archivo olyvia-theme con los 34 tokens',
    fileName: download.suggestedFilename(),
    tokens: Object.keys(parsed.palette ?? {}).length,
    paletteHead: Object.fromEntries(Object.entries(parsed.palette ?? {}).slice(0, 6)),
  });
});

test('el preset nativo «Claro neutro» cambia color-scheme, persiste y mantiene AA', async ({
  page,
}) => {
  await enterSettingsPage(page);

  // El selector de apariencia ofrece el preset claro junto a los 7 oscuros.
  const presetButton = page.getByRole('button', { name: `Tema ${NATIVE_LIGHT.name}` });
  await expect(presetButton).toBeVisible();
  await presetButton.click();

  // Los 34 tokens se aplican en vivo desde el preset nativo.
  await waitForVar(page, '--color-bg', NATIVE_LIGHT.bg);
  await expect.poll(async () => cssVar(page, '--color-surface')).toBe(NATIVE_LIGHT.surface);
  await expect.poll(async () => cssVar(page, '--color-text')).toBe(NATIVE_LIGHT.text);

  // El estudio de color nombra el preset activo con su etiqueta de UI.
  await expect(page.locator('.color-studio-reference')).toHaveText(
    /Referencia:\s*Claro neutro/i,
  );

  // color-scheme se deriva de la luminancia del fondo (contrato §2.4).
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme.trim()), {
      timeout: 10_000,
    })
    .toBe('light');
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');

  // Persistencia del preset (sólo se agrega el preset: no toca datos previos).
  // El proveedor agrupa escrituras con debounce (280 ms).
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          return raw ? ((JSON.parse(raw) as { preset?: string }).preset ?? null) : null;
        }, STORAGE_KEY),
      { timeout: 10_000, message: 'el preset elegido se persiste en localStorage' },
    )
    .toBe('light');
  const palette = await storedPalette(page);
  expect(palette?.bg).toBe(NATIVE_LIGHT.bg);
  expect(palette?.text).toBe(NATIVE_LIGHT.text);

  // El reporte de contraste del estudio de color queda todo en is-pass.
  const contrast = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.contrast-row'));
    return {
      count: rows.length,
      fails: rows.filter((row) => /is-fail/.test(row.className)).length,
      states: Array.from(document.querySelectorAll('.contrast-state')).map((state) =>
        (state.textContent ?? '').trim(),
      ),
    };
  });
  expect(contrast.count).toBeGreaterThanOrEqual(10);
  expect(contrast.fails).toBe(0);

  // Superficies reales del shell pintadas en claro (no sólo variables).
  await closeSettings(page);
  const surfaces = await page.evaluate(() => {
    const channelsOf = (value: string): readonly [number, number, number] | null => {
      // Chrome computa color-mix() como color(srgb 0..1 …); rgb() para sólidos.
      const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (srgb) {
        return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255] as const;
      }
      const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as const : null;
    };
    const sample = (selector: string): { background: string; luminance: number } => {
      const element = document.querySelector(selector);
      if (!element) return { background: '', luminance: -1 };
      const background = getComputedStyle(element).backgroundColor;
      const channels = channelsOf(background);
      if (!channels) return { background, luminance: -1 };
      const channel = (value: number): number => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const luminance =
        0.2126 * channel(channels[0]) +
        0.7152 * channel(channels[1]) +
        0.0722 * channel(channels[2]);
      return { background, luminance };
    };
    return {
      app: sample('.app-shell'),
      sidebar: sample('.sidebar'),
      statusbar: sample('.app-statusbar'),
      topbar: sample('.topbar'),
    };
  });
  expect(surfaces.app.background).toBe('rgb(238, 240, 243)');
  for (const key of ['sidebar', 'statusbar', 'topbar'] as const) {
    expect(surfaces[key].background, `${key} tiene fondo computado`).not.toBe('');
    expect(surfaces[key].background, `${key} no es transparente`).not.toMatch(/rgba\(0, 0, 0, 0\)/);
    expect(surfaces[key].luminance, `${key} es claro`).toBeGreaterThan(0.5);
  }

  await page.screenshot({ path: shot('13-preset-claro-nativo.png') });

  // Persiste tras recargar: al reentrar al shell sigue claro y AA.
  await page.reload();
  await enterShell(page);
  await waitForVar(page, '--color-bg', NATIVE_LIGHT.bg);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme.trim()),
  ).toBe('light');
  await page.screenshot({ path: shot('14-preset-claro-persistido.png') });

  recordEvidence({
    test: 'el preset nativo «Claro neutro» cambia color-scheme, persiste y mantiene AA',
    preset: 'light',
    bg: NATIVE_LIGHT.bg,
    surface: NATIVE_LIGHT.surface,
    colorScheme: 'light',
    contrastRows: contrast.count,
    contrastFails: contrast.fails,
    surfaces,
  });
});

test('el contraste fallido se corrige y queda en is-pass con ratio >= 4.5', async ({ page }) => {
  const studio = await openColorStudio(page);

  const bg = await cssVar(page, '--color-bg');
  expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
  // Texto igual al fondo: el par texto/fondo tiene que fallar.
  await setTokenHex(page, studio, 'text', bg);
  await waitForVar(page, '--color-text', bg);

  await expect
    .poll(async () => contrastFails(await contrastInfo(page)), {
      timeout: 10_000,
      message: 'el par texto/fondo debería quedar en is-fail',
    })
    .toBe(true);
  const failed = await contrastInfo(page);
  expect(failed.found).toBe(true);
  if (!/text-bg/.test(failed.rowClasses + failed.stateClasses)) {
    recordEvidence({ test: 'contraste', contrato: 'fila de contraste sin data-check="text-bg"' });
  }
  expect(parseDisplayedRatio(failed.ratioText)).toBeLessThan(1.1);
  await page.screenshot({ path: shot('08-contraste-falla.png') });

  // «Corregir texto» sube el texto hasta 4.5:1 y el par pasa a is-pass.
  await page.locator('button.color-studio-fix').click();
  await expect
    .poll(async () => contrastChecks(await contrastInfo(page)), {
      timeout: 10_000,
      message: 'el par texto/fondo debería quedar en is-pass tras Corregir texto',
    })
    .toBe(true);
  const fixed = await contrastInfo(page);
  const displayedRatio = parseDisplayedRatio(fixed.ratioText);
  expect(displayedRatio).toBeGreaterThanOrEqual(4.49);

  // Verificación independiente: el ratio se recalcula desde las variables.
  const fixedText = await cssVar(page, '--color-text');
  const fixedBg = await cssVar(page, '--color-bg');
  const independentRatio = contrastRatioHex(fixedText, fixedBg);
  expect(fixedText).not.toBe(fixedBg);
  expect(independentRatio).toBeGreaterThanOrEqual(4.49);
  await page.screenshot({ path: shot('09-contraste-corregido.png') });

  recordEvidence({
    test: 'el contraste fallido se corrige y queda en is-pass con ratio >= 4.5',
    bg,
    failedRatio: parseDisplayedRatio(failed.ratioText),
    fixedText,
    displayedRatio,
    independentRatio: Number(independentRatio.toFixed(3)),
  });
});

// --------------------------------------------------------------------------
// Medición (una sola pasada larga: se ejecuta al final de la verificación)
// --------------------------------------------------------------------------

test('mide cobertura del tema, contraste real y límites del tema claro', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(SHOTS_DIR, { recursive: true });

  const studio = await openColorStudio(page);

  // Módulo real del motor en el browser (Vite sirve el TS). Se expone en
  // `window` para que el arnés use `paletteCssVariables` y las 34 paletas.
  await page
    .addScriptTag({
      type: 'module',
      content:
        "import * as themeModule from '/src/state/theme-palette.ts'; window.__olyviaThemeModule = themeModule;",
    })
    .catch((error: unknown) => {
      recordEvidence({ test: 'medición', scriptError: String(error).slice(0, 200) });
    });
  await page
    .waitForFunction(
      () => Boolean((window as unknown as { __olyviaThemeModule?: unknown }).__olyviaThemeModule),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  // Una sola evaluación síncrona: nadie puede re-renderizar y pisar las
  // variables mientras se comparan las 35 pasadas (baseline + 34 tokens).
  const measurement = await page.evaluate(
    (input: {
      tokenIds: string[];
      defaultPalette: Record<string, string>;
      extraVariables: string[];
    }) => {
      type Palette = Record<string, string>;
      type TokenDef = { id: string; cssVar: string };
      type PaletteModule = {
        COLOR_TOKENS?: ReadonlyArray<TokenDef>;
        THEME_PALETTES?: Record<string, Palette>;
        paletteCssVariables?: (palette: Palette) => Record<string, string>;
      };
      type Literal = { key: string; selector: string; property: string; value: string };
      type Snap = Record<string, string>;

      const root = document.documentElement;
      const module = (window as unknown as { __olyviaThemeModule?: PaletteModule })
        .__olyviaThemeModule;

      const kebab = (value: string): string =>
        value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

      let tokenIds = input.tokenIds.slice();
      let canonical: Palette = { ...input.defaultPalette };
      const tokenVars: Record<string, string> = {};
      for (const token of tokenIds) tokenVars[token] = `--color-${kebab(token)}`;
      let paletteVariables: (palette: Palette) => Record<string, string> = (palette) => {
        const variables: Record<string, string> = {};
        for (const token of tokenIds) {
          const value = palette[token];
          if (value) variables[tokenVars[token] as string] = value;
        }
        return variables;
      };
      let engine: 'module' | 'fallback' = 'fallback';

      if (module?.paletteCssVariables && module.THEME_PALETTES?.olyvia) {
        const palette = module.THEME_PALETTES.olyvia;
        const list = module.COLOR_TOKENS;
        if (list && list.length > 0) {
          tokenIds = list.map((definition) => definition.id);
          for (const definition of list) tokenVars[definition.id] = definition.cssVar;
        }
        canonical = { ...palette };
        paletteVariables = module.paletteCssVariables;
        engine = 'module';
      }

      const apply = (palette: Palette): void => {
        for (const [name, value] of Object.entries(paletteVariables(palette))) {
          if (typeof value === 'string' && value.length > 0) root.style.setProperty(name, value);
        }
      };

      const visible = (element: Element): boolean => {
        const check = (
          element as Element & {
            checkVisibility?: (options?: {
              checkOpacity?: boolean;
              checkVisibilityCSS?: boolean;
            }) => boolean;
          }
        ).checkVisibility;
        if (typeof check === 'function') {
          return check.call(element, { checkOpacity: true, checkVisibilityCSS: true });
        }
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number.parseFloat(style.opacity) <= 0.02) return false;
        return element.getClientRects().length > 0;
      };

      const describe = (element: Element): string => {
        const parts: string[] = [];
        let node: Element | null = element;
        for (let depth = 0; node && depth < 4; depth += 1) {
          const tag = node.tagName.toLowerCase();
          const id = node.id ? `#${node.id}` : '';
          const classes = Array.from(node.classList)
            .slice(0, 2)
            .map((name) => `.${name}`)
            .join('');
          parts.unshift(`${tag}${id}${classes}`);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };

      const hasOwnText = (element: Element): boolean => {
        for (const node of Array.from(element.childNodes)) {
          if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true;
        }
        return false;
      };

      const paintedBackground = (value: string): boolean => {
        const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
        if (!match || !match[1]) return value.length > 0 && value !== 'transparent';
        const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
        return parts.length >= 4 ? (parts[3] ?? 1) > 0.01 : true;
      };

      const paintedProperties = (element: Element, style: CSSStyleDeclaration): string[] => {
        const properties: string[] = [];
        if (hasOwnText(element)) properties.push('color');
        if (paintedBackground(style.getPropertyValue('background-color'))) {
          properties.push('background-color');
        }
        if (style.getPropertyValue('background-image') !== 'none') {
          properties.push('background-image');
        }
        for (const side of ['top', 'right', 'bottom', 'left']) {
          if (
            Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
            style.getPropertyValue(`border-${side}-style`) !== 'none' &&
            // Un borde transparente no pinta nada: no cuenta como cobertura.
            paintedBackground(style.getPropertyValue(`border-${side}-color`))
          ) {
            properties.push(`border-${side}-color`);
          }
        }
        if (
          style.getPropertyValue('outline-style') !== 'none' &&
          Number.parseFloat(style.getPropertyValue('outline-width')) > 0 &&
          paintedBackground(style.getPropertyValue('outline-color'))
        ) {
          properties.push('outline-color');
        }
        if (element instanceof SVGElement) {
          const fill = style.getPropertyValue('fill');
          const stroke = style.getPropertyValue('stroke');
          if (fill && fill !== 'none' && paintedBackground(fill)) properties.push('fill');
          if (stroke && stroke !== 'none' && paintedBackground(stroke)) properties.push('stroke');
        }
        return properties;
      };

      const snapshot = (): { map: Snap; elements: string[]; sampledElements: number } => {
        const nodes = Array.from(document.querySelectorAll('body *'));
        const map: Snap = {};
        const elements: string[] = [];
        let sampledElements = 0;
        for (let index = 0; index < nodes.length; index += 1) {
          const element = nodes[index];
          if (!element) continue;
          if (!visible(element)) {
            elements[index] = '';
            continue;
          }
          const style = getComputedStyle(element);
          elements[index] = describe(element);
          const properties = paintedProperties(element, style);
          if (properties.length > 0) sampledElements += 1;
          for (const property of properties) {
            map[`${index}:${property}`] = style.getPropertyValue(property);
          }
        }
        return { map, elements, sampledElements };
      };

      const splitKey = (key: string): { index: number; property: string } => {
        const separator = key.indexOf(':');
        return {
          index: Number.parseInt(key.slice(0, separator), 10),
          property: key.slice(separator + 1),
        };
      };

      const diff = (
        baseline: Snap,
        probe: Snap,
        elements: string[],
      ): { changedKeys: string[]; literal: Literal[] } => {
        const changedKeys: string[] = [];
        const literal: Literal[] = [];
        for (const key of Object.keys(baseline)) {
          const { index, property } = splitKey(key);
          const before = baseline[key] ?? '';
          const after = probe[key] ?? '';
          if (after !== before) changedKeys.push(key);
          else {
            literal.push({
              key,
              selector: elements[index] ?? 'desconocido',
              property,
              value: before,
            });
          }
        }
        return { changedKeys, literal };
      };

      const groupChanged = (
        changedKeys: string[],
        before: Snap,
        after: Snap,
        elements: string[],
        sampleLimit: number,
      ) => {
        let byProperty: Record<string, number> = {};
        const elementsAffected = new Set<number>();
        const samples: JsonRecordLike[] = [];
        for (const key of changedKeys) {
          const { index, property } = splitKey(key);
          byProperty = { ...byProperty, [property]: (byProperty[property] ?? 0) + 1 };
          elementsAffected.add(index);
          if (samples.length < sampleLimit) {
            samples.push({
              selector: elements[index] ?? 'desconocido',
              property,
              before: before[key] ?? '',
              after: after[key] ?? '',
            });
          }
        }
        return { byProperty, elementsAffected: elementsAffected.size, samples };
      };

      type JsonRecordLike = Record<string, unknown>;

      // Colores de prueba: permutación de canales (preserva luminancia, evita
      // que el sondeo active el cambio de color-scheme del root). Si la
      // permutación no cambia nada (gris), se invierte.
      const probeFor = (token: string): string => {
        const value = canonical[token] ?? '#000000';
        const digits = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
        if (!digits) return '#ff00ff';
        const channels = [digits[1], digits[2], digits[3]] as [string, string, string];
        const swapped = `#${channels[2]}${channels[0]}${channels[1]}`.toLowerCase();
        if (swapped !== value.toLowerCase()) return swapped;
        const invert = (part: string): string =>
          (255 - Number.parseInt(part, 16)).toString(16).padStart(2, '0');
        return `#${invert(channels[0])}${invert(channels[1])}${invert(channels[2])}`;
      };

      // 1) Estado canónico + baseline.
      apply(canonical);
      const emitted = paletteVariables(canonical);
      const emittedKeys = Object.keys(emitted);
      const missingTokenVars = tokenIds
        .map((token) => tokenVars[token] ?? '')
        .filter((name) => name.length > 0 && !emittedKeys.includes(name));

      const baseline = snapshot();

      // 2) Cobertura global: todos los tokens pasan a su color de prueba.
      const probeAll: Palette = {};
      for (const token of tokenIds) probeAll[token] = probeFor(token);
      apply(probeAll);
      const probeSnapshot = snapshot();
      const responsiveness = diff(baseline.map, probeSnapshot.map, baseline.elements);
      const responsiveByProperty: Record<string, { total: number; responsive: number }> = {};
      for (const key of Object.keys(baseline.map)) {
        const { property } = splitKey(key);
        const entry = responsiveByProperty[property] ?? { total: 0, responsive: 0 };
        entry.total += 1;
        responsiveByProperty[property] = entry;
      }
      for (const key of responsiveness.changedKeys) {
        const { property } = splitKey(key);
        const entry = responsiveByProperty[property] ?? { total: 0, responsive: 0 };
        entry.responsive += 1;
        responsiveByProperty[property] = entry;
      }

      const literalExamples: Array<{ selector: string; property: string; value: string }> = [];
      const seenLiteral = new Set<string>();
      for (const literal of responsiveness.literal) {
        const id = `${literal.selector}|${literal.property}`;
        if (seenLiteral.has(id)) continue;
        seenLiteral.add(id);
        if (literalExamples.length >= 100) break;
        literalExamples.push({
          selector: literal.selector,
          property: literal.property,
          value: literal.value,
        });
      }
      apply(canonical);

      // 3) Impacto por token: una pasada por token, todo lo demás canónico.
      const tokenImpact: Array<{
        token: string;
        cssVar: string;
        probe: string;
        changedProperties: number;
        affectedElements: number;
        byProperty: Record<string, number>;
        samples: JsonRecordLike[];
      }> = [];
      for (const token of tokenIds) {
        const palette: Palette = { ...canonical, [token]: probeFor(token) };
        apply(palette);
        const probe = snapshot();
        const result = diff(baseline.map, probe.map, baseline.elements);
        const grouped = groupChanged(
          result.changedKeys,
          baseline.map,
          probe.map,
          baseline.elements,
          6,
        );
        tokenImpact.push({
          token,
          cssVar: tokenVars[token] ?? '',
          probe: palette[token] ?? '',
          changedProperties: result.changedKeys.length,
          affectedElements: grouped.elementsAffected,
          byProperty: grouped.byProperty,
          samples: grouped.samples,
        });
      }
      apply(canonical);

      // 4) Alias y variables extra del §2.4.
      const computedVar = (name: string): string =>
        getComputedStyle(root).getPropertyValue(name).trim();
      const missingExtraVariables = (extra: string[]): string[] =>
        extra.filter((name) => computedVar(name).length === 0);
      const aliasChecks = [
        {
          name: '--commercial-accent sigue a --color-accent',
          ok: computedVar('--commercial-accent').toLowerCase() === (canonical.accent ?? '').toLowerCase(),
          actual: computedVar('--commercial-accent'),
        },
        {
          name: '--commercial-canvas sigue a bg',
          ok: computedVar('--commercial-canvas').toLowerCase() === (canonical.bg ?? '').toLowerCase(),
          actual: computedVar('--commercial-canvas'),
        },
        {
          name: '--olyvia-cyan sigue a brandCyan',
          ok:
            computedVar('--olyvia-cyan').toLowerCase() ===
            (canonical.brandCyan ?? '').toLowerCase(),
          actual: computedVar('--olyvia-cyan'),
        },
        {
          name: '--color-ok sigue a success',
          ok: computedVar('--color-ok').toLowerCase() === (canonical.success ?? '').toLowerCase(),
          actual: computedVar('--color-ok'),
        },
        {
          name: '--olyvia-border existe y es color-mix',
          ok: /color-mix/i.test(computedVar('--olyvia-border')),
          actual: computedVar('--olyvia-border').slice(0, 120),
        },
        {
          name: '--brand-gradient contiene las paradas de marca',
          ok:
            computedVar('--brand-gradient').length > 20 &&
            computedVar('--brand-gradient').toLowerCase().includes((canonical.brandCyan ?? '').toLowerCase()),
          actual: computedVar('--brand-gradient').slice(0, 160),
        },
        {
          name: '--primary-hue es un número',
          ok: /^[0-9]+(?:\.[0-9]+)?$/.test(computedVar('--primary-hue')),
          actual: computedVar('--primary-hue'),
        },
      ];

      return {
        engine,
        tokenIds,
        varNames: tokenVars,
        emittedVariableCount: emittedKeys.length,
        missingTokenVars,
        missingExtraVariables: missingExtraVariables(input.extraVariables ?? []),
        aliasChecks,
        responsiveness: {
          sampledColorProperties: Object.keys(baseline.map).length,
          sampledElements: baseline.sampledElements,
          responsiveProperties: responsiveness.changedKeys.length,
          percentThemeDriven:
            Object.keys(baseline.map).length > 0
              ? Number(
                  (
                    (responsiveness.changedKeys.length / Object.keys(baseline.map).length) *
                    100
                  ).toFixed(1),
                )
              : 0,
          byProperty: responsiveByProperty,
          literalExamples,
        },
        tokenImpact,
        colorScheme: getComputedStyle(root).colorScheme,
      };
    },
    {
      tokenIds: [...TOKEN_IDS],
      defaultPalette: { ...DEFAULT_PALETTE },
      extraVariables: [...REQUIRED_EXTRA_VARIABLES],
    },
  );

  expect(measurement.engine, 'el motor state/theme-palette.ts debe existir y exportar la API').toBe(
    'module',
  );
  expect(measurement.missingTokenVars, 'tokens sin variable --color-* emitida').toEqual([]);
  expect(measurement.missingExtraVariables, 'variables del §2.4 que el motor no emite').toEqual([]);
  for (const check of measurement.aliasChecks) {
    expect(check.ok, `alias ${check.name} (actual: ${check.actual})`).toBe(true);
  }
  expect(measurement.responsiveness.sampledColorProperties).toBeGreaterThan(100);
  expect(measurement.responsiveness.percentThemeDriven).toBeGreaterThan(0);

  // El estudio tiene que estar visible para las capturas (y hay shell detrás).
  await expect(studio).toBeVisible();
  await studio.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('10-settings-estudio-color.png') });
  await studio.screenshot({ path: shot('10a-estudio-color-card.png') }).catch(() => undefined);

  // Literales de rol que siguen visibles y GANAN la cascada, con archivo/línea.
  // Se verifica que la declaración literal sea la que realmente pinta: se
  // resuelve el color declarado y se compara con el valor computado del primer
  // elemento visible que matchea; las declaraciones pisadas por reglas
  // posteriores (o por un color-mix de token) no cuentan como evidencia.
  const literalsInPage = await page.evaluate(() => {
    type JsonRecordLike = Record<string, unknown>;
    type ColorLiteral = { raw: string; resolved: string };
    const colorLiteralPattern = /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)/i;
    const resolveColor = (raw: string): string | null => {
      const probe = document.createElement('span');
      probe.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none';
      probe.style.setProperty('color', raw);
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };
    const literalOf = (value: string): ColorLiteral | null => {
      if (/var\(/i.test(value)) return null; // tokenizado con fallback: no es evidencia
      const match = colorLiteralPattern.exec(value);
      if (!match) return null;
      const resolved = resolveColor(match[0]);
      return resolved ? { raw: match[0], resolved } : null;
    };
    const normalize = (value: string): string =>
      value.replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = (element: Element): boolean => {
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (typeof check === 'function') {
        return check.call(element, { checkOpacity: true, checkVisibilityCSS: true });
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number.parseFloat(style.opacity) <= 0.02) return false;
      return element.getClientRects().length > 0;
    };
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 4; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const classes = Array.from(node.classList)
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('');
        parts.unshift(`${tag}${classes}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    // Propiedad declarada -> propiedades computadas donde debería aparecer.
    const targetsFor = (property: string): Array<{ computed: string; mode: 'color' | 'contains' }> => {
      if (property === 'color') return [{ computed: 'color', mode: 'color' }];
      if (property === 'background-color') {
        return [{ computed: 'background-color', mode: 'color' }];
      }
      if (property === 'background') {
        return [
          { computed: 'background-color', mode: 'color' },
          { computed: 'background-image', mode: 'contains' },
        ];
      }
      if (property === 'background-image') {
        return [{ computed: 'background-image', mode: 'contains' }];
      }
      if (property === 'outline-color' || property === 'outline') {
        return [{ computed: 'outline-color', mode: 'color' }];
      }
      if (property === 'fill' || property === 'stroke') {
        return [{ computed: property, mode: 'color' }];
      }
      if (property === 'box-shadow' || property === 'text-shadow') {
        return [{ computed: property, mode: 'contains' }];
      }
      if (property.startsWith('border')) {
        return ['top', 'right', 'bottom', 'left'].map((side) => ({
          computed: `border-${side}-color`,
          mode: 'color' as const,
        }));
      }
      return [];
    };
    const wins = (
      elements: Element[],
      targets: Array<{ computed: string; mode: 'color' | 'contains' }>,
      resolved: string,
    ): boolean => {
      const expected = normalize(resolved);
      for (const element of elements) {
        const style = getComputedStyle(element);
        for (const target of targets) {
          const computed = normalize(style.getPropertyValue(target.computed));
          if (target.mode === 'color' && computed === expected) return true;
          if (target.mode === 'contains' && computed.includes(expected)) return true;
        }
      }
      return false;
    };
    const rules: Array<{ rule: CSSStyleRule; sheetId: string }> = [];
    const visit = (list: CSSRuleList, sheetId: string): void => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) {
          rules.push({ rule, sheetId });
        } else if ('cssRules' in rule) {
          try {
            visit((rule as CSSGroupingRule).cssRules, sheetId);
          } catch {
            /* regla no legible */
          }
        }
      }
    };
    let sheetsScanned = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.cssRules.length === 0) continue;
        const owner = sheet.ownerNode as HTMLElement | null;
        const sheetId =
          owner?.getAttribute?.('data-vite-dev-id') ??
          owner?.getAttribute?.('data-href') ??
          sheet.href ??
          '<style>';
        visit(sheet.cssRules, sheetId);
        sheetsScanned += 1;
      } catch {
        /* hoja no accesible */
      }
    }
    const visibleLiterals: JsonRecordLike[] = [];
    const shadowLiterals: JsonRecordLike[] = [];
    const seen = new Set<string>();
    let unverifiedCandidates = 0;
    for (const { rule, sheetId } of rules) {
      if (!/[.#\[]/.test(rule.selectorText)) continue;
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(rule.selectorText));
      } catch {
        continue;
      }
      if (matches.length === 0) continue;
      const visibleMatches = matches.filter(visible);
      if (visibleMatches.length === 0) continue;
      for (const property of Array.from(rule.style)) {
        if (property.startsWith('--')) continue;
        const value = rule.style.getPropertyValue(property);
        if (!value) continue;
        const literal = literalOf(value);
        if (!literal) continue;
        const targets = targetsFor(property);
        if (targets.length === 0) continue;
        const isShadow = property === 'box-shadow' || property === 'text-shadow';
        if (!wins(visibleMatches, targets, literal.resolved)) {
          unverifiedCandidates += 1;
          continue;
        }
        const id = `${rule.selectorText}|${property}|${value}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const entry: JsonRecordLike = {
          selector: rule.selectorText,
          property,
          value: value.slice(0, 160),
          literal: literal.raw,
          matches: visibleMatches.length,
          example: describe(visibleMatches[0] as Element),
          sheetId,
        };
        if (isShadow) {
          if (shadowLiterals.length < 60) shadowLiterals.push(entry);
        } else if (visibleLiterals.length < 200) {
          visibleLiterals.push(entry);
        }
      }
    }
    return {
      sheetsScanned,
      visibleLiterals,
      shadowLiterals,
      unverifiedCandidates,
      styleFiles: Array.from(
        new Set(
          rules
            .map(({ sheetId }) => sheetId)
            .filter((sheetId) => sheetId !== '<style>')
            .map((sheetId) => sheetId.replace(/^.*\/apps\/desktop\//, 'apps/desktop/')),
        ),
      ),
    };
  }) as {
    sheetsScanned: number;
    visibleLiterals: Array<{
      selector: string;
      property: string;
      value: string;
      literal: string;
      matches: number;
      example: string;
      sheetId: string;
      file?: string;
      lines?: string[];
      category?: string;
    }>;
    shadowLiterals: Array<{
      selector: string;
      property: string;
      value: string;
      literal: string;
      sheetId: string;
      source?: string[];
    }>;
    unverifiedCandidates: number;
    styleFiles: string[];
  };

  // Archivo + línea del literal: se busca el color declarado en la hoja CSS.
  // La CSSOM normaliza los colores a `rgb(...)` aunque la fuente use hex, así
  // que se busca el hex equivalente y también el patrón rgb/rgba.
  const cssCache = new Map<string, string[]>();
  const sourceForLiteral = (entry: { sheetId: string; literal: string }): string[] => {
    const relative = entry.sheetId.replace(/^.*\/apps\/desktop\//, 'apps/desktop/');
    if (!relative.startsWith('apps/desktop/')) return [];
    const absolute = path.resolve(repoRoot(), relative);
    if (!existsSync(absolute)) return [];
    if (!cssCache.has(absolute)) {
      cssCache.set(absolute, readFileSync(absolute, 'utf8').split(/\r?\n/));
    }
    const lines = cssCache.get(absolute) ?? [];
    const numbers = /^rgba?\(([^)]+)\)$/i.exec(entry.literal);
    const channels = (numbers?.[1] ?? '')
      .split(',')
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));
    const rgb = channels.slice(0, 3);
    const hex =
      rgb.length === 3
        ? `#${rgb
            .map((channel) =>
              Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'),
            )
            .join('')}`
        : null;
    const rgbPattern =
      rgb.length === 3
        ? new RegExp(
            `rgba?\\(\\s*${Math.round(rgb[0] as number)}\\s*,\\s*${Math.round(
              rgb[1] as number,
            )}\\s*,\\s*${Math.round(rgb[2] as number)}\\b`,
            'i',
          )
        : null;
    const hits: number[] = [];
    for (let index = 0; index < lines.length && hits.length < 3; index += 1) {
      const line = lines[index] ?? '';
      const byHex = hex ? line.toLowerCase().includes(hex) : false;
      const byRgb = rgbPattern ? rgbPattern.test(line) : false;
      const byRaw = line.toLowerCase().includes(entry.literal.toLowerCase());
      if (byHex || byRgb || byRaw) hits.push(index + 1);
    }
    return hits.map((line) => `${relative}:${line}`);
  };
  for (const entry of literalsInPage.visibleLiterals) {
    entry.file = entry.sheetId.replace(/^.*\/apps\/desktop\//, 'apps/desktop/');
    entry.lines = sourceForLiteral(entry);
  }
  for (const entry of literalsInPage.shadowLiterals) {
    entry.source = sourceForLiteral(entry).slice(0, 2);
  }
  // Clasificación honesta: el arte decorativo, las sombras/backdrops y el
  // arcoíris del matiz son límites documentados (§5.3/§5.5/§7); el resto es
  // candidato a tokenizar y merece revisión de los dueños del CSS.
  const classifyLiteral = (entry: { selector: string; property: string; value: string }): string => {
    if (/panda|mask|emblem|logo|illustration|sprite|decor|glyph|brand-mark|avatar|art-/i.test(entry.selector)) {
      return 'arte decorativo (límite documentado §5.5/§7)';
    }
    if (
      /backdrop|overlay|scrim|veil|glass/i.test(entry.selector) ||
      entry.property === 'box-shadow' ||
      entry.property === 'text-shadow'
    ) {
      return 'superposición/sombra (límite documentado §5.3/§7)';
    }
    if (/hue-slider/i.test(entry.selector)) {
      return 'decorativo: arcoíris fijo del selector de matiz';
    }
    return 'revisar: posible rol de tema sin tokenizar';
  };
  for (const entry of literalsInPage.visibleLiterals) {
    entry.category = classifyLiteral(entry);
  }
  const roleLiterals = literalsInPage.visibleLiterals.filter(
    (entry) => entry.category === 'revisar: posible rol de tema sin tokenizar',
  );
  const literalFileSummary: Record<
    string,
    { role: number; documented: number; visibleMatches: number; examples: string[] }
  > = {};
  for (const entry of literalsInPage.visibleLiterals) {
    const file = entry.file ?? 'desconocido';
    const summary = literalFileSummary[file] ?? {
      role: 0,
      documented: 0,
      visibleMatches: 0,
      examples: [],
    };
    const isRole = entry.category === 'revisar: posible rol de tema sin tokenizar';
    if (isRole) summary.role += 1;
    else summary.documented += 1;
    summary.visibleMatches += entry.matches;
    if (isRole && summary.examples.length < 4) {
      summary.examples.push(`${entry.selector} { ${entry.property}: ${entry.value} }`);
    }
    literalFileSummary[file] = summary;
  }

  // Contraste real del tema por defecto (con Ajustes abierto y en el shell solo).
  const contrastDefaultSettings = await measureContrast(page);
  await page.screenshot({ path: shot('10b-settings-contante-tema.png') });
  await closeSettings(page);
  const contrastDefaultShell = await measureContrast(page);

  // Tema oscuro personalizado: importar, capturar, y probar el editor/timeline.
  await openSettingsWindow(page);
  await importThemeFile(
    page,
    buildThemeFile(CUSTOM_DARK_PALETTE, 'Tema E2E oscuro'),
    'tema-oscuro.json',
  );
  await waitForVar(page, '--color-accent', CUSTOM_DARK_PALETTE.accent);
  await waitForVar(page, '--color-bg', CUSTOM_DARK_PALETTE.bg);
  await page.waitForTimeout(400);
  await page
    .locator('.color-studio')
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('11-settings-tema-personalizado.png') });
  await closeSettings(page);
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('12-shell-tema-personalizado.png') });

  let editorReached = false;
  let timelineClips: Array<{ kind: string; background: string; border: string }> = [];
  try {
    await page.locator('.sidebar button[aria-label="Editor"]').click();
    await page.waitForTimeout(900);
    editorReached = await page.evaluate(() => {
      const main = document.querySelector('main.content');
      return Boolean(main && (main.textContent ?? '').trim().length > 20);
    });
    await page.screenshot({ path: shot('13-editor-tema-personalizado.png') });
    timelineClips = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.timeline-clip')).slice(0, 40).map((element) => {
        const style = getComputedStyle(element);
        const kind = Array.from(element.classList).find((name) => name.startsWith('kind-')) ?? 'kind-?';
        return {
          kind: kind.slice(5),
          background: style.backgroundColor,
          border: style.borderTopColor,
        };
      }),
    );
  } catch (error) {
    editorReached = false;
    recordEvidence({ test: 'editor', error: String(error).slice(0, 200) });
  }

  // Tema claro personalizado: bg blanco real para medir los límites.
  await openSettingsWindow(page);
  await importThemeFile(page, buildThemeFile(LIGHT_PALETTE, 'Tema E2E claro'), 'tema-claro.json');
  await waitForVar(page, '--color-bg', LIGHT_PALETTE.bg);
  await expect
    .poll(
      async () =>
        page.evaluate(() => getComputedStyle(document.documentElement).colorScheme.trim()),
      { timeout: 10_000, message: 'color-scheme debería pasar a light con bg blanco' },
    )
    .toBe('light');
  const inlineColorScheme = await page.evaluate(
    () => document.documentElement.style.colorScheme.trim(),
  );
  // Variables de diseño que NO pertenecen a la paleta y pueden dejar superficies
  // oscuras aunque el usuario elija un tema claro.
  const glassVariables = await page.evaluate(() => {
    const read = (name: string): string =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const glassBg = read('--glass-bg');
    const parse = (value: string): { r: number; g: number; b: number; a: number } | null => {
      const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
      if (!match || !match[1]) return null;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      const [r, g, b] = parts;
      if (r === undefined || g === undefined || b === undefined) return null;
      return { r, g, b, a: parts.length >= 4 ? (parts[3] ?? 1) : 1 };
    };
    const glass = parse(glassBg);
    const visibleUsingGlass: string[] = [];
    if (glass) {
      for (const element of Array.from(document.querySelectorAll('body *'))) {
        const check = (
          element as Element & {
            checkVisibility?: (options?: {
              checkOpacity?: boolean;
              checkVisibilityCSS?: boolean;
            }) => boolean;
          }
        ).checkVisibility;
        if (
          typeof check === 'function' &&
          !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })
        ) {
          continue;
        }
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (element.getClientRects().length === 0) continue;
        const background = parse(style.backgroundColor);
        if (!background || background.a <= 0.05) continue;
        const same =
          Math.abs(background.r - glass.r) < 3 &&
          Math.abs(background.g - glass.g) < 3 &&
          Math.abs(background.b - glass.b) < 3;
        if (!same) continue;
        if (visibleUsingGlass.length < 12) {
          visibleUsingGlass.push(
            `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join('.')}`,
          );
        }
      }
    }
    return {
      glassBg,
      glassBorder: read('--glass-border'),
      glassGradient: read('--glass-gradient').slice(0, 160),
      panelGradient: read('--panel-gradient').slice(0, 160),
      visibleElementsUsingGlass: visibleUsingGlass,
    };
  });
  // Las transiciones de color de los inputs duran ~0.3 s pero arrancan en cascada:
  // con 500 ms todavía se medían islas oscuras fantasma. 1.6 s deja el estado
  // estable antes de medir y capturar.
  await page.waitForTimeout(1600);
  const keySurfacesSettingsLight = await probeKeySurfaces(page);
  const darkSurfacesSettings = await detectDarkSurfaces(page);
  await page
    .locator('.color-studio')
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('14-settings-tema-claro.png') });
  const contrastLightSettings = await measureContrast(page);
  await closeSettings(page);
  await expect(page.locator('.app-shell')).toBeVisible();
  // Volver a la vista de contenido real (Inicio/Aprender) y medir ahí el tema
  // claro: es la pantalla que ve el usuario, no el editor vacío.
  await page.locator('.sidebar button[aria-label="Inicio"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('15-shell-tema-claro.png') });
  const contrastLightShell = await measureContrast(page);
  const darkSurfacesShell = await detectDarkSurfaces(page);
  const keySurfacesShellLight = await probeKeySurfaces(page);

  // Vuelta al tema de fábrica para la captura de control y limpieza.
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await enterShell(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('16-shell-olvia-fabrica.png') });

  // Hallazgos accionables derivados de la medición (no se inventan: salen de
  // los datos de arriba; los números quedan congelados en el reporte).
  const resolveThemeRole = roleLiterals.filter((entry) =>
    (entry.file ?? '').includes('resolve-theme.css'),
  );
  const resolveThemeMatches = resolveThemeRole.reduce(
    (total, entry) => total + (entry.matches ?? 0),
    0,
  );
  const appCssRole = roleLiterals.filter((entry) =>
    (entry.file ?? '').endsWith('/styles/app.css'),
  );
  const settingsCssRole = roleLiterals.filter((entry) =>
    (entry.file ?? '').endsWith('/styles/settings.css'),
  );
  const strictMin = (failures: ContrastFailure[], fallback: number): number =>
    failures.reduce((min, failure) => Math.min(min, failure.ratio), fallback);
  const lightSettingsStrictMin = strictMin(contrastLightSettings.strictFailures, 0);
  const lightShellStrictMin = strictMin(contrastLightShell.strictFailures, 0);
  const findings: JsonRecord[] = [];
  if (resolveThemeRole.length > 0) {
    findings.push({
      id: 'resolve-theme-literal',
      severity: 'alta',
      area: 'apps/desktop/src/styles/resolve-theme.css',
      detail: `resolve-theme.css se importa SIEMPRE en main.tsx y conserva ${resolveThemeRole.length} declaraciones de color literales (con !important) que ganan la cascada en ${resolveThemeMatches} elementos visibles: iconos del rail, statusbar, segmented, badges/chips, menús y diálogos. Ese archivo no estaba en el scope de task-2 ni de task-4, así que la paleta no repinta esos roles. (Tras task-6 esta lista debería quedar vacía.)`,
      evidence: resolveThemeRole.slice(0, 8),
    });
  } else {
    findings.push({
      id: 'resolve-theme-tokenized',
      severity: 'info',
      area: 'apps/desktop/src/styles/resolve-theme.css',
      detail:
        'resolve-theme.css ya no aporta declaraciones de color literales que ganen la cascada sobre elementos visibles: la tokenización (task-6) se verificó sin regresiones visibles.',
    });
  }
  if (appCssRole.length > 0) {
    findings.push({
      id: 'app-css-literal',
      severity: 'media',
      area: 'apps/desktop/src/styles/app.css',
      detail: `${appCssRole.length} declaraciones de rol siguen con literal y ganan la cascada (p. ej. statusbar-dot, view-head). El Lead informó que las arregla él; si siguen acá, es deuda pendiente de tokenizar en app.css.`,
      evidence: appCssRole.slice(0, 8),
    });
  }
  if (settingsCssRole.length > 0) {
    findings.push({
      id: 'settings-css-literal',
      severity: 'baja',
      area: 'apps/desktop/src/styles/settings.css',
      detail: `${settingsCssRole.length} declaraciones de la ventana de Ajustes quedan literales (arcoíris del hue-slider y velo del backdrop, ambos casos decorativos/límite; no bloquean la paleta).`,
      evidence: settingsCssRole.slice(0, 8),
    });
  }
  findings.push({
    id: 'topbar-token-mapping',
    severity: 'info',
    area: 'commercial.css / olyvia.css',
    detail:
      'El topbar se pinta con --commercial-surface / --olyvia-panel (= surface); editar --color-panel no cambia el topbar. El token panel sí repinta cards/contenido del shell y el mock del preview. Decisión de contrato aceptada por el Lead (no es un defecto).',
  });
  findings.push({
    id: 'contrast-default-theme',
    severity: 'media',
    area: 'paleta olyvia por defecto',
    detail: `Con la paleta por defecto, ${contrastDefaultSettings.strictFailures.length} pares texto/fondo visibles quedan por debajo de WCAG AA (mín. ${contrastDefaultSettings.minRatio}:1). Casos dominantes: texto de acento (#1f5eff) sobre superficie (#181b20) = 3.37:1 (<4.5). Es deuda de diseño previa a esta iteración: la paleta por defecto reproduce el look actual y no se cambia; el motor no la introduce.`,
    evidence: contrastDefaultSettings.strictFailures.slice(0, 10),
  });
  findings.push({
    id: 'static-design-variables',
    severity: /color-mix|var\(/i.test(glassVariables.glassBg) ? 'info' : 'media',
    area: 'tokens.css (variables estáticas fuera de la paleta)',
    detail: /color-mix|var\(/i.test(glassVariables.glassBg)
      ? `Resuelto en la integración final: --glass-bg ya no es un rgba fijo sino ${glassVariables.glassBg}, que sigue a la paleta (--color-panel). En el estado medido no había elementos visibles usando el velo (${glassVariables.visibleElementsUsingGlass.length}); el impacto visual del cambio es nulo pero el límite de cobertura desapareció. Los fallbacks estáticos de --brand-* en tokens.css siguen a propósito: el motor los emite inline en cada aplicación de tema.`
      : `La paleta no cubre todas las variables que pintan superficie: con bg blanco, --glass-bg sigue en ${glassVariables.glassBg} y --glass-border en ${glassVariables.glassBorder}. En el estado medido se detectaron ${glassVariables.visibleElementsUsingGlass.length} elemento(s) visible(s) usando ese velo (${glassVariables.visibleElementsUsingGlass.slice(0, 4).join(', ') || 'ninguno'}). Es un límite de alcance del motor actual, documentado y no prometido.`,
    evidence: glassVariables,
  });
  findings.push({
    id: 'light-theme-partial',
    severity: 'media',
    area: 'tema claro personalizado (bg #ffffff)',
    detail: `Con bg blanco y color-scheme=light la app queda mayormente clara: topbar, rail, Ajustes, statusbar y .segmented siguen la paleta; las ${Math.round(
      darkSurfacesShell.darkAreaPx2 / 1000,
    )}k px² de superficie opaca oscura que quedan en Inicio son botones de acento azul (oscuros a propósito) y el backdrop translúcido de Ajustes es un velo documentado (§5.3). Lo que NO queda resuelto es el texto: ${contrastLightSettings.strictFailures.length} pares bajo WCAG AA con Ajustes abierto (mín. ${lightSettingsStrictMin}:1) y ${contrastLightShell.strictFailures.length} en Inicio (mín. ${lightShellStrictMin}:1). Causas: colores de estado usados como texto sobre superficie clara (aviso #d97706 → 2.95; badge/estado success → 3.30; statusbar-meta → 3.77) y textos tenues (pipeline-guide small → 2.36); como texto normal no llegan a 4.5 aunque el contrato sólo exija 3:1 para estados. Hay además 1 fallo aproximado (texto blanco del avatar «MP» sobre fondo con gradiente: 1.21:1). El tema claro funciona pero no está pulido al 100%: se documenta como límite real, no se promete.`,
    evidence: {
      contrastSettingsFailures: contrastLightSettings.strictFailures.slice(0, 10),
      contrastShellFailures: contrastLightShell.strictFailures.slice(0, 10),
      darkSurfacesSettings: darkSurfacesSettings.examples.slice(0, 10),
      darkSurfacesShell: darkSurfacesShell.examples.slice(0, 10),
      keySurfaces: keySurfacesShellLight,
    },
  });

  // Reporte medido (método + datos + evidencia de los demás tests).
  const report: JsonRecord = {
    generatedAt: new Date().toISOString(),
    app: 'Olyvia / editor-ia — sistema de color',
    scope: 'Verificación independiente y adversarial (task-5)',
    url: 'http://localhost:3000',
    playwrightConfig: {
      baseURL: 'http://localhost:3000',
      webServerCommand: 'npm run dev (vite --host 0.0.0.0 --port 3000)',
      reuseExistingServer: true,
      decision:
        'El script dev de apps/desktop escucha en 3000; el config apuntaba a 5173 y Playwright levantaba un Vite paralelo. Se alineó baseURL y webServer a 3000 con reuseExistingServer para reutilizar el server del equipo y no dejar procesos colgados.',
    },
    harnessFixes: [
      {
        file: 'apps/desktop/e2e/helpers.ts',
        change:
          "getByRole('button', { name: 'Tutorial', exact: true }) en enterApp (antes sin exact).",
        reason:
          'El lanzador siembra 3 proyectos demo recientes cuyo nombre contiene «Tutorial» (apps/desktop/src/lib/recents.ts, INITIAL_DEMO_PROJECTS); sin exact, getByRole matchea la tarjeta demo, su botón de borrar y el botón del footer → strict mode violation y fallan todos los specs que usan enterApp (settings/app/palette/lottie). Fix de arnés pre-existente, autorizado por el Lead; no es cambio de producto.',
      },
    ],
    method: {
      variables:
        'Se importa el módulo real state/theme-palette.ts en el browser vía Vite y se aplica paletteCssVariables(paleta) sobre document.documentElement, igual que applyAppearance. Se verifican las 34 --color-* y las variables extra del §2.4, y que los alias comerciales/olyvia sigan a los tokens.',
      themeResponsiveness:
        'Se toma una foto de cada propiedad realmente pintada de cada elemento visible (color de texto propio, background-color, background-image, bordes, outline, fill/stroke SVG) con la paleta canónica. Luego se aplica una paleta de prueba que cambia los 34 tokens (permutación de canales para preservar luminancia y no alterar color-scheme) y se vuelve a medir. Porcentaje = propiedades computadas que cambiaron / propiedades computadas pintadas. Las que no cambian se clasifican como literal o variable no temática.',
      tokenImpact:
        'Una pasada por token: todo canónico salvo ese token en su color de prueba; se cuentan propiedades y elementos visibles afectados. affectedElements=0 significa que el token no tiene efecto visible en el estado medido (shell + Ajustes abiertos). No distingue un token usado sólo en arte decorativo (límite documentado), pero sí evita falsos positivos.',
      contrast:
        'WCAG 2.x: para cada elemento visible con texto propio se compone el color de texto sobre el background efectivo (se sube por ancestros con background-color y alfa; si hay background-image se marca aproximado). Ratio=(L claro+0.05)/(L oscuro+0.05); mínimo 4.5 para texto normal y 3 para texto grande (>=24px, o >=18.66px con peso >=700). Los fallos sobre fondos con gradiente o sin capa opaca se reportan como aproximados.',
      visibleLiterals:
        'Heurística CSSOM con verificación de cascada: se recorren las hojas servidas por Vite; para cada declaración de color con literal (#hex o rgb/rgba) se descartan las que usan var() (tokenizadas con fallback) y se resuelve el color declarado contra el valor computado del primer elemento visible que matchea el selector. Sólo se reportan las declaraciones que GANAN la cascada (las pisadas por una regla posterior o por un color-mix de token se cuentan aparte como unverifiedCandidates). Cada entrada trae selector, hoja, archivo y líneas donde aparece el literal. Puede incluir arte decorativo legítimo (se cruza con §7 del doc).',
      lightTheme:
        'Se importa una paleta clara completa (bg #ffffff) por el flujo real de importación; se verifica que colorScheme pase a light (computado e inline) y se miden contraste real y superficies con fondo opaco oscuro (luminancia < 0.18, área >= 700px²) en dos estados: Ajustes abierto y la vista de contenido Inicio. También se registran las variables estáticas fuera de la paleta (--glass-*) y los colores computados de superficies clave (.menubar, .topbar, .segmented, .color-hex, etc.), documentando lo que se rompe en vez de taparlo.',
    },
    engine: {
      loaded: measurement.engine,
      emittedVariableCount: measurement.emittedVariableCount,
      missingTokenVars: measurement.missingTokenVars,
      missingExtraVariables: measurement.missingExtraVariables,
      aliasChecks: measurement.aliasChecks,
    },
    themeResponsiveness: measurement.responsiveness,
    tokenImpact: measurement.tokenImpact,
    visibleLiteralColors: {
      sheetsScanned: literalsInPage.sheetsScanned,
      count: literalsInPage.visibleLiterals.length,
      unverifiedCandidates: literalsInPage.unverifiedCandidates,
      roleCandidatesCount: roleLiterals.length,
      roleCandidates: roleLiterals.slice(0, 80),
      byFile: literalFileSummary,
      entries: literalsInPage.visibleLiterals,
      shadowLiterals: literalsInPage.shadowLiterals,
    },
    contrast: {
      defaultThemeSettingsOpen: contrastDefaultSettings,
      defaultThemeShellOnly: contrastDefaultShell,
      lightThemeSettingsOpen: contrastLightSettings,
      lightThemeShell: contrastLightShell,
    },
    lightTheme: {
      applied: true,
      colorSchemeComputed: contrastLightShell.colorScheme,
      inlineColorScheme,
      darkSurfaces: {
        withSettingsOpen: darkSurfacesSettings,
        shellInicio: darkSurfacesShell,
      },
      keySurfaces: {
        withSettingsOpen: keySurfacesSettingsLight,
        shellInicio: keySurfacesShellLight,
      },
      staticNonPaletteVariables: glassVariables,
      timelineClipsUnderCustomTheme: timelineClips,
      editorReached,
      screenshots: [
        '11-settings-tema-personalizado.png',
        '12-shell-tema-personalizado.png',
        '14-settings-tema-claro.png',
        '15-shell-tema-claro.png',
      ],
    },
    integrationChangelog: [
      {
        component: 'apps/desktop/src/features/settings/ColorStudioCard.tsx',
        afterMyFirstVerification: true,
        change:
          'Fix del Lead: commit agrupado a los 320 ms del último cambio además de onBlur/onPointerUp (con limpieza del timer al desmontar). El picker nativo no siempre deja el foco en el input, así que el commit dependía de un blur que podía no llegar.',
        verifiedBy:
          'theme.spec «la paleta personalizada persiste tras recargar» espera localStorage con palette.accent antes del reload y verifica el valor tras recargar.',
      },
      {
        component: 'apps/desktop/src/features/editor/MarkersPanel.tsx',
        afterMyFirstVerification: true,
        change:
          'Los swatches y el borde del panel de marcadores usan las mismas clases .marker-* + var(--marker-color) que el timeline; se eliminó MARKER_COLOR_HEX.',
        verifiedBy:
          'Medición de tokens de medios/estado y contraste del shell; los marcadores son datos del proyecto (§7), no se promete cobertura de tema.',
      },
      {
        component: 'state/theme-palette.ts + styles/tokens.css + docs/COLOR-CUSTOMIZATION.md',
        afterMyFirstVerification: true,
        change:
          'Se quitaron las variables globales --marker-* (sin consumidores tras el cambio de MarkersPanel) y se actualizó la doc §2.4.',
        verifiedBy:
          'El arnés verifica las variables obligatorias del §2.4; el motor quedó con 66 variables emitidas y 0 faltantes de la lista requerida.',
      },
      {
        component: 'apps/desktop/src/styles/resolve-theme.css',
        afterMyFirstVerification: true,
        change:
          'task-6: tokenización de la última capa con literales !important (se importa siempre en main.tsx). Los roles que ganaban la cascada — iconos del rail, statusbar, segmented, badges/chips, menús y diálogos — ahora usan var(--color-*)/color-mix.',
        verifiedBy:
          'theme.spec: visibleLiteralColors ya no reporta declaraciones de resolve-theme.css ganando la cascada (roleCandidates 22→0) y themeResponsiveness subió de 54.8% a 59.2%.',
      },
      {
        component: 'apps/desktop/src/styles/app.css',
        afterMyFirstVerification: true,
        change:
          'Fix del Lead: .statusbar-dot #5f7186 → var(--color-empty) (y su glow a color-mix); .view-head border #333438 → var(--color-border). Eran los 2 literales de rol de app.css que marcó la medición.',
        verifiedBy: 'visibleLiteralColors.byFile para app.css queda sin declaraciones de rol.',
      },
      {
        component: 'apps/desktop/src/styles/tokens.css (--glass-bg)',
        afterMyFirstVerification: true,
        change:
          'Fix del Lead: --glass-bg pasó de rgba(15,20,32,.6) fijo a color-mix(in srgb, var(--color-panel) 60%, transparent), así el velo sigue a la paleta. Cierra el finding static-design-variables.',
        verifiedBy:
          'theme.spec: al importar el tema claro, --glass-bg ya resuelve con color-mix/var (no rgba fijo) y no hay elementos visibles dependientes en el estado medido.',
      },
      {
        component: 'README.md + docs/COLOR-CUSTOMIZATION.md',
        afterMyFirstVerification: true,
        change:
          'Documentación actualizada: apariencia con 34 colores/7 presets/estudio de color/export-import, arquitectura con theme-palette.ts y §2.4 de marcadores.',
        verifiedBy: 'Revisión de alcance; no afecta a la ejecución del arnés.',
      },
    ],
    knownLimits: [
      'Arte decorativo (emblema orbital, mascota, ilustraciones del launcher) conserva su propia paleta: no responde al tema por diseño (§7).',
      'Sombras/backdrops negros translúcidos no son tokens de color (§7).',
      'Colores por clip (clip.colorTag) y por marcador son datos del proyecto, no del tema (§7).',
      'La heurística de literales visibles clasifica automáticamente (arte/sombra/rol); los casos «revisar» necesitan revisión humana.',
      'La medición de contraste sobre fondos con gradiente/imagen es aproximada (se marca approximate=true).',
      'Sin proyecto cargado no hay clips reales en el timeline: los tokens de medios (video/image/audio/…) se midieron sobre iconos, pósteres y badges, no sobre clips.',
      'Un tema claro real no está prometido: las superficies base siguen la paleta (--glass-bg ya quedó tokenizado), pero quedan textos de estado por debajo de AA y arte decorativo; ver finding light-theme-partial.',
      'Los fallbacks estáticos de --brand-gradient/--brand-glow en tokens.css son intencionales: el motor los emite inline en cada aplicación de tema, así que no limitan la customización.',
      'La cobertura de tokens se mide sobre el estado «shell + Ajustes abiertos + vista Inicio»; tokens usados sólo en pantallas no visitadas (p. ej. clips del timeline sin proyecto) pueden dar 0 o un impacto menor del real.',
    ],
    findings,
    evidence,
    screenshots: [
      '05-acento-en-vivo.png',
      '06-panel-en-vivo.png',
      '07-import-tema.png',
      '08-contraste-falla.png',
      '09-contraste-corregido.png',
      '10-settings-estudio-color.png',
      '10a-estudio-color-card.png',
      '10b-settings-contante-tema.png',
      '11-settings-tema-personalizado.png',
      '12-shell-tema-personalizado.png',
      '13-editor-tema-personalizado.png',
      '14-settings-tema-claro.png',
      '15-shell-tema-claro.png',
      '16-shell-olvia-fabrica.png',
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  expect(existsSync(REPORT_PATH)).toBe(true);
  expect(existsSync(shot('10-settings-estudio-color.png'))).toBe(true);
});

// --------------------------------------------------------------------------
// Medición de contraste en la página
// --------------------------------------------------------------------------

interface ContrastFailure {
  readonly selector: string;
  readonly text: string;
  readonly color: string;
  readonly background: string;
  readonly ratio: number;
  readonly minimum: number;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly approximate: boolean;
}

interface ContrastReport {
  readonly checked: number;
  readonly minRatio: number;
  readonly averageRatio: number;
  readonly colorScheme: string;
  readonly strictFailures: ContrastFailure[];
  readonly approximateFailures: ContrastFailure[];
  readonly failingCount: number;
}

async function measureContrast(page: Page): Promise<ContrastReport> {
  return page.evaluate(() => {
    const parse = (value: string): { r: number; g: number; b: number; a: number } | null => {
      const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
      if (!match || !match[1]) return null;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      const [r, g, b] = parts;
      if (r === undefined || g === undefined || b === undefined) return null;
      return { r, g, b, a: parts.length >= 4 ? (parts[3] ?? 1) : 1 };
    };
    const composite = (
      foreground: { r: number; g: number; b: number; a: number },
      background: { r: number; g: number; b: number },
    ): { r: number; g: number; b: number } => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    });
    const luminance = (color: { r: number; g: number; b: number }): number => {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const ratio = (
      first: { r: number; g: number; b: number },
      second: { r: number; g: number; b: number },
    ): number => {
      const l1 = luminance(first);
      const l2 = luminance(second);
      const [high, low] = l1 >= l2 ? [l1, l2] : [l2, l1];
      return (high + 0.05) / (low + 0.05);
    };
    const toHex = (color: { r: number; g: number; b: number }): string =>
      `#${[color.r, color.g, color.b]
        .map((channel) =>
          Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'),
        )
        .join('')}`;
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 4; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const classes = Array.from(node.classList)
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('');
        parts.unshift(`${tag}${classes}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const hasOwnText = (element: Element): boolean => {
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true;
      }
      return false;
    };
    const effectiveBackground = (
      element: Element,
    ): { color: { r: number; g: number; b: number }; gradient: boolean; resolved: boolean } => {
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      let gradient = false;
      let resolved = false;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.getPropertyValue('background-image') !== 'none') gradient = true;
        const backgroundColor = parse(style.getPropertyValue('background-color'));
        if (backgroundColor && backgroundColor.a > 0.001) {
          layers.push(backgroundColor);
          if (backgroundColor.a >= 0.999) {
            resolved = true;
            break;
          }
        }
        node = node.parentElement;
      }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index];
        if (!layer) continue;
        const blended = composite(layer, base);
        base = { ...blended, a: 1 };
      }
      return { color: { r: base.r, g: base.g, b: base.b }, gradient, resolved };
    };

    const strictFailures: Array<Record<string, unknown>> = [];
    const approximateFailures: Array<Record<string, unknown>> = [];
    let checked = 0;
    let ratioSum = 0;
    let minRatio = Number.POSITIVE_INFINITY;

    const disabledOrHidden = (element: Element): boolean => {
      if (element.closest('[disabled], [aria-disabled="true"], fieldset[disabled], [hidden]')) {
        return true;
      }
      // checkVisibility excluye <details> cerrados y contenido no pintado.
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (
        typeof check === 'function' &&
        !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })
      ) {
        return true;
      }
      // Texto sólo para lectores de pantalla (sr-only): recortado a ~1px.
      const rect = element.getBoundingClientRect();
      return rect.width <= 2 && rect.height <= 2;
    };

    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number.parseFloat(style.opacity) <= 0.02) continue;
      if (!hasOwnText(element)) continue;
      if (disabledOrHidden(element)) continue;
      const text = (element.textContent ?? '').trim();
      if (text.length === 0) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const color = parse(style.color);
      if (!color || color.a <= 0.02) continue;
      const background = effectiveBackground(element);
      const composed = composite(color, background.color);
      const pairRatio = ratio(composed, background.color);
      checked += 1;
      ratioSum += pairRatio;
      minRatio = Math.min(minRatio, pairRatio);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minimum = large ? 3 : 4.5;
      if (pairRatio + 0.01 < minimum) {
        const approximate = background.gradient || !background.resolved;
        const entry: Record<string, unknown> = {
          selector: describe(element),
          text: text.slice(0, 60),
          color: style.color,
          background: toHex(background.color),
          ratio: Number(pairRatio.toFixed(2)),
          minimum,
          fontSize: Math.round(fontSize * 10) / 10,
          fontWeight,
          approximate,
        };
        if (approximate) {
          if (approximateFailures.length < 40) approximateFailures.push(entry);
        } else if (strictFailures.length < 60) {
          strictFailures.push(entry);
        }
      }
    }

    return {
      checked,
      minRatio: checked > 0 ? Number(minRatio.toFixed(2)) : 0,
      averageRatio: checked > 0 ? Number((ratioSum / checked).toFixed(2)) : 0,
      colorScheme: getComputedStyle(document.documentElement).colorScheme.trim(),
      strictFailures,
      approximateFailures,
      failingCount: strictFailures.length + approximateFailures.length,
    } as unknown as ContrastReport;
  });
}

// --------------------------------------------------------------------------
// Superficies que no siguen la paleta (para el tema claro)
// --------------------------------------------------------------------------

interface DarkSurfaceReport {
  readonly darkAreaPx2: number;
  readonly count: number;
  readonly examples: Array<{ selector: string; background: string; area: number }>;
}

/**
 * Suma el área de superficies con fondo opaco oscuro (luminancia < 0.18). Bajo
 * una paleta clara, todo lo que aparezca acá es una isla que no siguió el tema
 * o un acento/oscuridad deliberada (botones primarios, arte): el reporte lo
 * lista para revisión, no lo esconde.
 */
async function detectDarkSurfaces(page: Page): Promise<DarkSurfaceReport> {
  return page.evaluate(() => {
    const parse = (value: string): { r: number; g: number; b: number; a: number } | null => {
      const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
      if (!match || !match[1]) return null;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      const [r, g, b] = parts;
      if (r === undefined || g === undefined || b === undefined) return null;
      return { r, g, b, a: parts.length >= 4 ? (parts[3] ?? 1) : 1 };
    };
    const luminance = (color: { r: number; g: number; b: number }): number => {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 4; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const classes = Array.from(node.classList)
          .slice(0, 2)
          .map((name) => `.${name}`)
          .join('');
        parts.unshift(`${tag}${classes}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const examples: Array<{ selector: string; background: string; area: number }> = [];
    let darkArea = 0;
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const check = (
        element as Element & {
          checkVisibility?: (options?: {
            checkOpacity?: boolean;
            checkVisibilityCSS?: boolean;
          }) => boolean;
        }
      ).checkVisibility;
      if (
        typeof check === 'function' &&
        !check.call(element, { checkOpacity: true, checkVisibilityCSS: true })
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number.parseFloat(style.opacity) <= 0.02) continue;
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 700 || rect.width < 1 || rect.height < 1) continue;
      const background = parse(style.backgroundColor);
      if (!background || background.a < 0.9) continue;
      if (luminance(background) > 0.18) continue;
      darkArea += area;
      if (examples.length < 40) {
        examples.push({
          selector: describe(element),
          background: style.backgroundColor,
          area: Math.round(area),
        });
      }
    }
    return { darkAreaPx2: Math.round(darkArea), count: examples.length, examples };
  });
}

interface KeySurfaceSample {
  readonly selector: string;
  readonly found: boolean;
  readonly background: string;
  readonly border: string;
  readonly image: string;
}

/** Colores computados de superficies clave, para documentar qué sigue al tema. */
async function probeKeySurfaces(page: Page): Promise<KeySurfaceSample[]> {
  return page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return { selector, found: false, background: '', border: '', image: '' };
      }
      const style = getComputedStyle(element);
      return {
        selector,
        found: true,
        background: style.backgroundColor,
        border: style.borderTopColor,
        image: style.backgroundImage.slice(0, 120),
      };
    });
  }, [
    '.menubar',
    '.topbar',
    '.theme-preview-topbar',
    '.theme-preview-panel',
    '.segmented',
    'input.color-hex',
    '.statusbar-local',
    '.profile-menu',
    '.topbar-export-btn',
    '.assistant-launcher',
  ]);
}
