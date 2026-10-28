import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_APP_VERSION } from './version';

function readVersion(relative: string): string | undefined {
  const raw = readFileSync(new URL(relative, import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version?: string }).version;
}

describe('CURRENT_APP_VERSION', () => {
  it('coincide con el package del desktop y con tauri.conf.json', () => {
    expect(readVersion('../../package.json')).toBe(CURRENT_APP_VERSION);
    expect(readVersion('../../src-tauri/tauri.conf.json')).toBe(CURRENT_APP_VERSION);
  });
});
