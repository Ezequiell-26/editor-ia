// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_APP_VERSION,
  checkForUpdates,
  compareSemver,
  loadUpdaterConfig,
  saveUpdaterConfig,
} from './updater-service';

afterEach(() => {
  window.localStorage.clear();
});

describe('updater-service', () => {
  it('compara versiones semver correctamente', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('v0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('guarda y recupera la configuración del actualizador en localStorage', () => {
    saveUpdaterConfig({
      autoCheck: false,
      channel: 'beta',
      lastChecked: '2026-10-22T20:00:00.000Z',
    });

    const config = loadUpdaterConfig();
    expect(config.autoCheck).toBe(false);
    expect(config.channel).toBe('beta');
    expect(config.lastChecked).toBe('2026-10-22T20:00:00.000Z');
  });

  it('detecta una nueva versión disponible respecto a la actual', async () => {
    const result = await checkForUpdates('stable');
    expect(result.available).toBe(true);
    expect(result.release).not.toBeNull();
    expect(result.release?.version).toBe('0.2.0');
    expect(result.release?.highlights.length).toBeGreaterThan(0);
  });
});
