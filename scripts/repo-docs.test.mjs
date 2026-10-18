import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function mentions(text, terms) {
  return terms.filter((term) => !text.toLowerCase().includes(term.toLowerCase()));
}

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}/i,
];

describe('README.md', () => {
  const readme = read('README.md');
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts);

  it('declara que existe hoy y que todavia no', () => {
    expect(readme).toMatch(/^## .*existe hoy/m);
    expect(readme).toMatch(/^## .*no existe|^## .*todavia no/m);
    for (const term of ['render', 'IA', 'UI', 'CI']) {
      expect(readme.toLowerCase(), `debe marcar ${term} como pendiente`).toContain(
        term.toLowerCase(),
      );
    }
  });

  it('documenta comandos que existen de verdad', () => {
    const documented = new Set(
      [...readme.matchAll(/npm (?:run ([a-z:]+)|test)/g)].map((match) => match[1] ?? 'test'),
    );
    expect(documented.size, 'README debe listar comandos').toBeGreaterThan(3);
    for (const name of documented) {
      expect(
        name === 'test' ? scripts.includes('test') : scripts.includes(name),
        `README documenta "npm run ${name}", que no existe`,
      ).toBe(true);
    }
    for (const absent of ['dev', 'build', 'tauri:dev', 'tauri:build']) {
      expect(readme, `README promete npm run ${absent}`).not.toMatch(
        new RegExp(`npm run ${absent.replace(':', ':')}\\b`),
      );
    }
  });

  it('enlaza a docs que existen', () => {
    const links = [...readme.matchAll(/\]\(([^)#?]+)\)/g)]
      .map((match) => match[1].trim())
      .filter((target) => !/^https?:/i.test(target));
    expect(links.length).toBeGreaterThan(1);
    for (const target of links) {
      expect(
        existsSync(resolve(repoRoot, target)),
        `link roto: ${target}`,
      ).toBe(true);
    }
  });

  it('fija requisitos medidos: Node, Rust estable y Windows', () => {
    const engines = JSON.parse(read('package.json')).engines.node;
    expect(readme).toContain(engines.replace('>=', '>= '));
    expect(readme).toMatch(/rust[^\n]*stable/i);
    expect(readme).toMatch(/windows/i);
    expect(readme).toMatch(/rust-env\.mjs/);
  });

  it('limita la licencia al codigo propio', () => {
    expect(mentions(readme, ['MIT', 'Remotion', 'terceros', 'stock'])).toEqual([]);
  });
});

describe('LICENSE', () => {
  const license = read('LICENSE');

  it('es MIT declarada, sin placeholders', () => {
    expect(license).toMatch(/^MIT License\s*$/im);
    expect(license).toMatch(/Copyright \(c\) \d{4} \S.+/i);
    expect(license).toContain('Permission is hereby granted, free of charge');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(license).not.toMatch(/\[[^\]]*\]|<[^>]+>|\bCOPYRIGHT HOLDER\b/i);
  });
});

describe('SECURITY.md', () => {
  const security = read('SECURITY.md');

  it('cubre el almacen de credenciales', () => {
    expect(security).toMatch(/^#.*seguridad/im);
    expect(mentions(security, ['credencial', 'almac', 'credential manager', 'localstorage']))
      .toEqual([]);
    const banned = ['api_key', 'access_token', 'refresh_token', 'secret', 'password',
      'authorization', 'cookie', 'private_key'];
    expect(mentions(security, banned), 'falta campo de credencial en la lista').toEqual([]);
    expect(security).toMatch(/rechaz/i);
  });

  it('cubre el gate de licencias de assets', () => {
    expect(mentions(security, ['commercialuse', 'not-for-redistribution', 'provenance',
      'requires-attribution', 'rights'])).toEqual([]);
    expect(security).toMatch(/license/i);
  });

  it('dice como reportar y prohibe credenciales en el reporte', () => {
    expect(security).toMatch(/^## .*reportar/im);
    expect(security).toMatch(/no .*incluy|prohibid/i);
  });

  it('no contiene credenciales reales', () => {
    for (const pattern of SECRET_PATTERNS) {
      expect(security, `posible secreto ${pattern}`).not.toMatch(pattern);
    }
    expect(read('README.md')).not.toMatch(SECRET_PATTERNS[2]);
  });
});

describe('.gitattributes', () => {
  const attributes = read('.gitattributes');

  it('normaliza eol y declara binarios', () => {
    expect(attributes).toMatch(/^\*\stext=auto\s+eol=lf\s*$/m);
    expect(attributes).toMatch(/^\*\.png\s+binary\s*$/m);
    expect(attributes).toMatch(/^\*\.mp4\s+binary\s*$/m);
    const rules = attributes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    for (const rule of rules) {
      expect(rule.split(/\s+/).length, `regla sin atributo: ${rule}`).toBeGreaterThan(1);
      expect(rule, `atributo pegado a otro token: ${rule}`).not.toMatch(/\bbinary[^\s:]/);
    }
    const probe = spawnSync('git', ['check-attr', 'eol', '--', 'README.md'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
    });
    expect(probe.stdout, probe.stderr).toContain('eol: lf');
  });

  it('git puede leer todas las reglas sin errores', () => {
    const probes = ['src/a.rs', 'docs/b.md', 'assets/clip.mp4', 'publica/font.woff2'];
    const run = spawnSync('git', ['check-attr', '-a', '--', ...probes], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr.trim(), 'git rechazo una regla de .gitattributes').toBe('');
    expect(run.stdout).toMatch(/clip\.mp4.*binary:\s*set/s);
    expect(run.stdout).toMatch(/font\.woff2.*text:\s*unset/s);
  });
});
