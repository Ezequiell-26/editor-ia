#!/usr/bin/env node
/**
 * rust-env — descubre un toolchain MSVC que realmente linkee y exporta el
 * entorno que `rustc` necesita en esta máquina.
 *
 * No se hardcodea una versión: se comprueba que existan `lib/x64/msvcrt.lib` y
 * `bin/Hostx64/x64/link.exe`. Esa es la condición medida que separa una carpeta
 * VC/Tools/MSVC utilizable de una que sólo tiene DLLs.
 *
 * Uso directo:
 *   node scripts/rust-env.mjs -- cargo build -p editor-ia-desktop
 */

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VS_ROOTS = [
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
  'C:\\Program Files\\Microsoft Visual Studio\\2022',
  'D:\\visualstudiocomunity',
];
const SDK_ROOT = 'C:\\Program Files (x86)\\Windows Kits\\10';

function readdir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function msvcCandidates() {
  const roots = [];
  for (const vsRoot of VS_ROOTS) {
    if (existsSync(join(vsRoot, 'VC', 'Tools', 'MSVC'))) {
      roots.push(join(vsRoot, 'VC', 'Tools', 'MSVC'));
      continue;
    }
    for (const edition of readdir(vsRoot)) {
      const nested = join(vsRoot, edition, 'VC', 'Tools', 'MSVC');
      if (existsSync(nested)) {
        roots.push(nested);
      }
    }
  }

  const found = [];
  for (const root of roots) {
    for (const version of readdir(root).sort().reverse()) {
      const base = join(root, version);
      const linker = join(base, 'bin', 'Hostx64', 'x64', 'link.exe');
      const resourceCompiler = join(base, 'bin', 'Hostx64', 'x64', 'rc.exe');
      const msvcrt = join(base, 'lib', 'x64', 'msvcrt.lib');
      const includes = join(base, 'include');
      if (existsSync(linker) && existsSync(msvcrt) && existsSync(includes)) {
        found.push({
          version,
          base,
          linker,
          msvcrt,
          includes,
          rc: existsSync(resourceCompiler),
        });
      }
    }
  }
  return found;
}

function sdkVersion() {
  const libRoot = join(SDK_ROOT, 'Lib');
  const includeRoot = join(SDK_ROOT, 'Include');
  const versions = readdir(libRoot)
    .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
    .filter((name) => existsSync(join(libRoot, name, 'ucrt', 'x64')))
    .filter((name) => existsSync(join(includeRoot, name, 'ucrt')))
    .sort();
  return versions.at(-1) ?? null;
}

export function discoverRustEnv() {
  const msvc = msvcCandidates();
  const sdk = sdkVersion();
  if (msvc.length === 0 || !sdk) {
    return {
      ready: false,
      reason: !sdk
        ? 'No se encontró un Windows SDK con Lib/ucrt/x64 e Include/ucrt.'
        : 'Ningún toolchain MSVC instalado tiene link.exe y lib/x64/msvcrt.lib a la vez.',
      candidates: msvc.map((item) => item.version),
    };
  }

  const chosen = msvc[0];
  const sdkBin = join(SDK_ROOT, 'bin', sdk, 'x64');
  const sdkRc = existsSync(join(sdkBin, 'rc.exe'));
  const lib = [
    join(chosen.base, 'lib', 'x64'),
    join(SDK_ROOT, 'Lib', sdk, 'ucrt', 'x64'),
    join(SDK_ROOT, 'Lib', sdk, 'um', 'x64'),
  ].join(';');
  const include = [
    chosen.includes,
    join(SDK_ROOT, 'Include', sdk, 'ucrt'),
    join(SDK_ROOT, 'Include', sdk, 'um'),
    join(SDK_ROOT, 'Include', sdk, 'shared'),
  ].join(';');

  // `tauri-build` compiles the Windows resource script (icon + manifest) with
  // rc.exe. The MSVC toolchains on this machine do not ship it, but the
  // Windows SDK does, so the SDK bin directory must be on PATH for every
  // Tauri build. The probe is measured, not assumed.
  const pathPrepends = [join(chosen.base, 'bin', 'Hostx64', 'x64')];
  if (sdkRc) {
    pathPrepends.push(sdkBin);
  }

  return {
    ready: true,
    msvcVersion: chosen.version,
    sdkVersion: sdk,
    rcAvailable: chosen.rc === true || sdkRc,
    rcPath: sdkRc ? join(sdkBin, 'rc.exe') : null,
    env: {
      LIB: lib,
      INCLUDE: include,
      PATH_PREPEND: pathPrepends.join(';'),
    },
    alternatives: msvc.map((item) => item.version),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf('--');

  if (dashdash === -1) {
    console.log(JSON.stringify(discoverRustEnv(), null, 2));
    return;
  }

  const command = argv.slice(dashdash + 1);
  const info = discoverRustEnv();
  if (!info.ready) {
    console.error(`Entorno Rust no listo: ${info.reason}`);
    process.exit(3);
  }

  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      LIB: info.env.LIB,
      INCLUDE: info.env.INCLUDE,
      PATH: `${info.env.PATH_PREPEND};${process.env.PATH ?? ''}`,
    },
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
