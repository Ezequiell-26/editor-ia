import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('la extensión pide permisos acotados y host opcional', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('downloads'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('el panel lateral y el service worker están declarados', () => {
  assert.equal(manifest.side_panel.default_path, 'src/sidepanel.html');
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.equal(manifest.background.type, 'module');
});
