#!/usr/bin/env node
/**
 * Firma una licencia de desarrollo con la clave privada del vendedor.
 *
 * La clave privada NUNCA se versiona. En producción la usa el servidor de la
 * Fase 4; para probar la app se pasa por variable de entorno o archivo.
 *
 * Uso:
 *   OLYVIA_LICENSE_PRIVATE_KEY=... node scripts/license-sign-dev.mjs \
 *     --email tester@example.com --id lic-test --out licencia.json
 *
 * La variable admite el PKCS#8 en base64 (una línea) o una ruta a un archivo
 * que lo contenga.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function privateKeyBytes() {
  const configured = process.env.OLYVIA_LICENSE_PRIVATE_KEY;
  if (!configured) {
    throw new Error('falta OLYVIA_LICENSE_PRIVATE_KEY (PKCS#8 base64 o ruta)');
  }
  const base64 = configured.includes('/') || configured.includes('\\')
    ? readFileSync(configured, 'utf8').trim()
    : configured.trim();
  return Buffer.from(base64, 'base64');
}

const payload = {
  v: 1,
  product: 'olyvia',
  tier: 'pro',
  licenseId: arg('id', `dev-${Date.now().toString(36)}`),
  email: arg('email', 'dev@olyvia.local'),
  issuedAt: new Date().toISOString(),
  expiresAtUnix: arg('expires') ? Number(arg('expires')) : null,
};
const payloadBytes = Buffer.from(JSON.stringify(payload));
const key = createPrivateKey({
  key: privateKeyBytes(),
  format: 'der',
  type: 'pkcs8',
});
const signature = sign(null, payloadBytes, key);
const file = {
  payload: payloadBytes.toString('base64'),
  signature: signature.toString('base64'),
};
const out = arg('out', 'olyvia-license.json');
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
console.log(`licencia firmada: ${out}`);
console.log(`  id: ${payload.licenseId}`);
console.log(`  email: ${payload.email}`);
