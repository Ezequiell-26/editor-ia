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

import { cpSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VS_ROOTS = [
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
  'C:\\Program Files\\Microsoft Visual Studio\\2022',
  'D:\\visualstudiocomunity',
];
const SDK_ROOT = 'C:\\Program Files (x86)\\Windows Kits\\10';

/**
 * FFmpeg de desarrollo (LGPL, shared) para compilar `video-rs`/`ffmpeg-sys-next`.
 * El ejecutable estático del bundle no sirve: el crate linkea avcodec.lib,
 * avformat.lib, avutil.lib, swscale.lib y swresample.lib, y bindgen necesita
 * libclang. La ruta se puede pisar con EDITOR_IA_FFMPEG_DEV.
 */
const FFMPEG_DEV_CANDIDATES = [
  process.env.EDITOR_IA_FFMPEG_DEV,
  'D:\\DevCache\\ffmpeg-n9.0-lgpl\\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0',
].filter(Boolean);
const LIBCLANG_CANDIDATES = [
  process.env.LIBCLANG_PATH,
  'D:\\DevCache\\py-libclang\\clang\\native',
  'C:\\Program Files\\LLVM\\bin',
].filter(Boolean);

function findLibclang() {
  for (const dir of LIBCLANG_CANDIDATES) {
    if (existsSync(join(dir, 'libclang.dll'))) {
      return dir;
    }
  }
  return null;
}

function findFfmpegDev() {
  for (const dir of FFMPEG_DEV_CANDIDATES) {
    if (!existsSync(dir)) continue;
    const header = join(dir, 'include', 'libavcodec', 'avcodec.h');
    const libs = readdir(join(dir, 'lib'));
    const binaries = readdir(join(dir, 'bin'));
    const hasImportLib = libs.some((name) => /^avcodec.*\.lib$/i.test(name));
    const hasRuntime = binaries.some((name) => /^avcodec.*\.dll$/i.test(name));
    if (existsSync(header) && hasImportLib && hasRuntime) {
      return {
        dir,
        bin: join(dir, 'bin'),
        pkgConfig: join(dir, 'lib', 'pkgconfig'),
        libclang: findLibclang(),
      };
    }
  }
  return null;
}

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

/**
 * CARGO_HOME tiene que ser escribible: `cargo fetch` agrega crates al registry
 * y el build compila dependencias en el propio home. En esta máquina el
 * CARGO_HOME configurado vive en una unidad de caché de sólo lectura para el
 * usuario (D://DevCache//Rust), así que se detecta midiendo —no asumiendo— y se
 * usa un reemplazo dentro de `target/`, que ya está ignorado por git. Para no
 * re-descargar todo el registry, se copia el contenido del home anterior la
 * primera vez (best-effort: si falla, cargo simplemente re-descarga).
 */
function isWritable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.writable-probe');
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function ensureCargoHome() {
  const configured = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  if (isWritable(configured)) return configured;

  const fallback = join(process.cwd(), 'target', '.cargo-home');
  if (!existsSync(join(fallback, 'registry')) && existsSync(join(configured, 'registry'))) {
    try {
      console.error(`rust-env: CARGO_HOME no escribible (${configured}); copiando caché a ${fallback}`);
      cpSync(join(configured, 'registry'), join(fallback, 'registry'), { recursive: true, force: true });
      if (existsSync(join(configured, 'git'))) {
        cpSync(join(configured, 'git'), join(fallback, 'git'), { recursive: true, force: true });
      }
    } catch {
      // Sin copia, cargo re-descarga lo que falta y sigue.
    }
  }
  if (!isWritable(fallback)) {
    console.error(`rust-env: no hay CARGO_HOME escribible; se sigue con ${configured}`);
    return configured;
  }
  return fallback;
}

function main() {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf('--');

  if (dashdash === -1) {
    console.log(
      JSON.stringify(
        { ...discoverRustEnv(), ffmpegDev: findFfmpegDev() },
        null,
        2,
      ),
    );
    return;
  }

  const command = argv.slice(dashdash + 1);
  const info = discoverRustEnv();
  if (!info.ready) {
    console.error(`Entorno Rust no listo: ${info.reason}`);
    process.exit(3);
  }
  const cargoHome = ensureCargoHome();
  const ffmpeg = findFfmpegDev();
  const pathParts = [info.env.PATH_PREPEND];
  // Las DLLs de FFmpeg dev se cargan al arrancar los ejecutables; su carpeta
  // tiene que estar en PATH. El `bin` completo se agrega al final para que el
  // `ffmpeg` de línea de comandos siga siendo el del sistema (el build LGPL
  // shared no trae libx264 y los tests live lo necesitan).
  const runtimeDlls = join(process.cwd(), 'apps', 'desktop', 'src-tauri', 'resources', 'ffmpeg-dll');
  if (readdir(runtimeDlls).some((name) => /^avcodec.*\.dll$/i.test(name))) {
    pathParts.push(runtimeDlls);
  }
  if (ffmpeg) {
    if (!ffmpeg.libclang) {
      console.error(
        'rust-env: falta libclang.dll; bindgen (ffmpeg-sys-next) no va a compilar. Instalá LLVM o pip install libclang.',
      );
    }
  }
  const pathSuffix = ffmpeg ? `;${ffmpeg.bin}` : '';
  const environment = {
    ...process.env,
    CARGO_HOME: cargoHome,
    LIB: info.env.LIB,
    INCLUDE: info.env.INCLUDE,
    PATH: `${pathParts.join(';')};${process.env.PATH ?? ''}${pathSuffix}`,
  };
  if (ffmpeg) {
    environment.FFMPEG_DIR = ffmpeg.dir;
    environment.PKG_CONFIG_PATH = [ffmpeg.pkgConfig, process.env.PKG_CONFIG_PATH]
      .filter(Boolean)
      .join(';');
    if (ffmpeg.libclang) {
      environment.LIBCLANG_PATH = ffmpeg.libclang;
    }
    // bindgen parsea headers de FFmpeg con recursión profunda; el stack por
    // defecto del build script en Windows desborda (0xc00000fd).
    if (!(process.env.RUSTFLAGS ?? '').includes('/STACK:')) {
      environment.RUSTFLAGS = `${process.env.RUSTFLAGS ?? ''} -C link-arg=/STACK:67108864`.trim();
    }
    console.error(
      `rust-env: FFmpeg dev ${ffmpeg.dir}${ffmpeg.libclang ? ' · libclang OK' : ' · sin libclang'}`,
    );
  }

  // El ejecutable de test de la lib no recibe `rustc-link-arg-bins` de
  // tauri-build, así que build.rs le agrega el manifiesto sólo en esta corrida.
  const cargoAt = command.findIndex((part) => /(^|[\\/])cargo(?:\.exe)?$/i.test(part));
  const subcommand =
    cargoAt >= 0
      ? command
          .slice(cargoAt + 1)
          .find((part) => !part.startsWith('-') && !part.startsWith('+') && !part.includes('='))
      : null;
  if (subcommand === 'test' || subcommand === 'nextest' || subcommand === 'bench') {
    environment.EDITOR_IA_TEST_BUILD = '1';
  }

  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: true,
    env: environment,
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
