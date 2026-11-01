#!/usr/bin/env node
// Prueba integral por herramientas MCP: proyecto creado por el servidor de
// archivos, abierto en la app, editado en vivo (imagen+cámara+parallax, rig,
// 3D, motion, efectos, transición, voz, música, subtítulos y escenas), guardado,
// renderizado y verificado con ffprobe + hashes de frames.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = argument(
  '--workspace',
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-integral'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'integral.editoria.json');
const spinSource = join(root, 'scripts', 'fixtures', 'model-spin.glb');
const spinModel = join(workspace, 'modelo-animado.glb');
if (existsSync(spinSource)) copyFileSync(spinSource, spinModel);
if (existsSync(projectPath)) rmSync(projectPath);
const bundled = join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = existsSync(bundled) ? bundled : 'ffmpeg';
const bundledProbe = join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe');
const ffprobe = existsSync(bundledProbe) ? bundledProbe : 'ffprobe';
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));

function run(command, args) {
  execFileSync(command, args, { stdio: 'ignore' });
}

const assets = {
  background: join(workspace, 'fondo.png'),
  cutout: join(workspace, 'recorte.png'),
  music: join(workspace, 'musica.wav'),
  voice: join(workspace, 'voz.wav'),
};

function generateAssets() {
  if (!existsSync(assets.background)) {
    try {
      run(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i',
        'gradients=s=1280x720:c0=0x0b1220:c1=0x1e3a8a:x0=0:y0=0:x1=1280:y1=720:d=1',
        '-frames:v', '1', assets.background,
      ]);
    } catch {
      run(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=0x0b1220:s=1280x720:d=1',
        '-frames:v', '1', assets.background,
      ]);
    }
  }
  if (!existsSync(assets.cutout)) {
    run(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=1,format=rgba',
      '-vf',
      "geq=r='245':g='158':b='11':a='if(lt((X-900)*(X-900)+(Y-330)*(Y-330),12100),255,0)'",
      '-frames:v', '1', assets.cutout,
    ]);
  }
  if (!existsSync(assets.music)) {
    run(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i',
      'aevalsrc=0.16*sin(220*2*PI*t)+0.12*sin(277.18*2*PI*t)+0.1*sin(329.63*2*PI*t):d=8',
      '-ac', '2', '-c:a', 'pcm_s16le', assets.music,
    ]);
  }
  if (!existsSync(assets.voice)) {
    const text =
      'Bienvenidos al motor universal de video. Esta prueba integral fue creada y renderizada por agentes.';
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.SetOutputToWaveFile('${assets.voice.replace(/'/g, "''")}'); $s.Speak('${text}'); $s.Dispose()`,
    ]);
  }
}

function createProject() {
  return new Promise((resolve, reject) => {
    if (existsSync(projectPath)) {
      resolve();
      return;
    }
    const server = spawn(
      process.execPath,
      [
        join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
        '--workspace', workspace,
        '--project', projectPath,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let buffer = '';
    const pending = new Map();
    server.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          const done = pending.get(message.id);
          pending.delete(message.id);
          done(message);
        }
      }
    });
    let id = 1;
    const request = (method, params) =>
      new Promise((done) => {
        const current = id++;
        pending.set(current, done);
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`);
      });
    (async () => {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integral', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Integral agente', width: 1280, height: 720, fps: 30 },
      });
      const outcome = JSON.parse(created.result?.content?.[0]?.text ?? '{}');
      if (outcome.ok !== true) throw new Error(outcome.summary ?? 'project_create falló');
      server.stdin.end();
      resolve();
    })().catch((error) => {
      server.kill();
      reject(error);
    });
  });
}

async function live(tool, args = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/mcp/tool`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-editoria-token': token },
      body: JSON.stringify({ tool, arguments: args }),
    });
    const payload = await response.json();
    return { status: response.status, ...payload };
  } finally {
    clearTimeout(timer);
  }
}

function must(result, label) {
  if (result.status !== 200 || result.ok !== true) {
    throw new Error(`${label}: ${result.summary ?? JSON.stringify(result)}`);
  }
  return result;
}

async function pollRender() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await live('render_status');
    if (status.data?.finished) return status.data.finished;
  }
  throw new Error('el render no terminó en 160 s');
}

try {
  generateAssets();
  await createProject();

  must(await live('project_open', { path: projectPath }), 'project_open');

  const imported = {};
  for (const [key, path] of Object.entries(assets)) {
    const result = must(await live('asset_import', { path }), `asset_import ${key}`);
    imported[key] = result.data.assets[0].id;
  }

  const parallax = must(
    await live('parallax_add', {
      backgroundAssetId: imported.background,
      foregroundAssetId: imported.cutout,
      preset: 'parallax-soft',
      intensity: 0.14,
      atFrame: 0,
      durationFrames: 120,
    }),
    'parallax_add',
  );
  must(
    await live('camera_move', {
      clipId: parallax.data.backgroundClipId,
      type: 'zoom-in',
      intensity: 0.12,
    }),
    'camera_move',
  );

  const rig = must(
    await live('rig_add', { clip: 'walk', seconds: 3 }),
    'rig_add',
  );
  const rigClip = must(
    await live('clip_add', { assetId: rig.data.assetId, atFrame: 120 }),
    'clip_add rig',
  ).data.clipId;
  must(
    await live('effect_apply', { clipId: rigClip, contrast: 1.12, saturation: 1.15 }),
    'effect_apply rig',
  );
  must(
    await live('transition_apply', { clipId: rigClip, type: 'dissolve', frames: 12 }),
    'transition_apply rig',
  );

  const three = must(
    await live('three_add', { preset: 'orbit-cube', seconds: 3 }),
    'three_add',
  );
  const threeClip = must(
    await live('clip_add', { assetId: three.data.assetId, atFrame: 210 }),
    'clip_add 3d',
  ).data.clipId;
  must(
    await live('effect_apply', { clipId: threeClip, grain: 0.12, curvePreset: 'contrast-soft' }),
    'effect_apply 3d',
  );
  must(
    await live('transition_apply', { clipId: threeClip, type: 'wipe-left', frames: 12 }),
    'transition_apply 3d',
  );
  const motionPath = must(
    await live('motion_path', {
      clipId: threeClip,
      path: [0, 0, 40, -24, 0, 0],
      durationFrames: 90,
      easing: 'ease-in-out',
    }),
    'motion_path',
  );

  const animated = must(
    await live('three_add', { modelPath: spinModel, seconds: 3 }),
    'three_add modelo animado',
  );
  const animatedClip = must(
    await live('clip_add', { assetId: animated.data.assetId, atFrame: 300 }),
    'clip_add modelo',
  ).data.clipId;

  const title = must(
    await live('motion_add', {
      templateId: 'title-card',
      text: 'Motor Universal',
      secondary: 'Prueba integral por agentes',
    }),
    'motion_add',
  );

  const voiceClip = must(
    await live('clip_add', { assetId: imported.voice, atFrame: 0 }),
    'clip_add voz',
  ).data.clipId;
  const musicClip = must(
    await live('clip_add', { assetId: imported.music, atFrame: 0 }),
    'clip_add música',
  ).data.clipId;

  must(
    await live('subtitle_add', {
      text: 'Motor Universal de video',
      startFrame: 0,
      durationFrames: 70,
    }),
    'subtitle_add 1',
  );
  must(
    await live('subtitle_add', {
      text: 'Creado y renderizado por agentes',
      startFrame: 75,
      durationFrames: 70,
    }),
    'subtitle_add 2',
  );

  const scenes = [
    {
      title: 'Apertura paralaje',
      narration: 'Una imagen con profundidad y cámara.',
      intent: 'hook',
      clipIds: [parallax.data.backgroundClipId, parallax.data.foregroundClipId, title.data.clipId],
    },
    {
      title: 'Personaje 2D',
      narration: 'Un personaje camina con esqueleto procedural.',
      intent: 'demo',
      clipIds: [rigClip],
    },
    {
      title: 'Objeto 3D',
      narration: 'Un cubo metálico cierra la pieza.',
      intent: 'proof',
      clipIds: [threeClip],
    },
    {
      title: 'Modelo animado',
      narration: 'Un glTF importado reproduce su clip de giro.',
      intent: 'outro',
      clipIds: [animatedClip],
    },
  ];
  for (const scene of scenes) {
    must(await live('scene_create', scene), `scene_create ${scene.title}`);
  }

  must(await live('transport', { action: 'save' }), 'save');
  const inspected = must(await live('project_inspect'), 'project_inspect');

  const started = must(
    await live('render_start', { includeCaptions: true }),
    'render_start',
  );
  const finished = await pollRender();
  if (finished.status !== 'completed' || !finished.outputPath) {
    throw new Error(`render falló: ${JSON.stringify(finished)}`);
  }
  if (!existsSync(finished.outputPath)) {
    throw new Error(`el MP4 no existe: ${finished.outputPath}`);
  }

  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration,size,format_name:stream=codec_name,width,height,r_frame_rate',
        '-of', 'json', finished.outputPath,
      ],
      { encoding: 'utf8' },
    ),
  );
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_name === 'h264');
  const audio = streams.find((stream) => stream.codec_name === 'aac');
  if (!video || !audio) throw new Error('el MP4 no tiene h264+aac');

  const hashes = [1, 5, 9, 12].map((seconds) =>
    execFileSync(
      ffmpeg,
      ['-v', 'error', '-ss', String(seconds), '-i', finished.outputPath, '-frames:v', '1', '-f', 'md5', '-'],
      { encoding: 'utf8' },
    ).trim(),
  );
  if (new Set(hashes).size !== hashes.length) {
    throw new Error(`los frames son idénticos: ${hashes.join(' / ')}`);
  }

  // Reproducción completa: decodifica todo el video y todo el audio; cualquier
  // error de demux/decode sale por stderr y falla la prueba.
  for (const [label, map] of [['video', '0:v:0'], ['audio', '0:a:0']]) {
    const decoded = spawnSync(
      ffmpeg,
      ['-v', 'error', '-i', finished.outputPath, '-map', map, '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    if (decoded.status !== 0 || decoded.stderr.trim() !== '') {
      throw new Error(`decode ${label} con errores: ${decoded.stderr.trim() || decoded.status}`);
    }
  }
  const decodedFrames = Number(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
       'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', finished.outputPath],
      { encoding: 'utf8' },
    ).trim(),
  );
  const expectedFrames = Math.round(Number(probe.format.duration) * 30);
  if (!Number.isFinite(decodedFrames) || Math.abs(decodedFrames - expectedFrames) > 2) {
    throw new Error(`frames decodificados ${decodedFrames}, esperados ~${expectedFrames}`);
  }

  if (inspected.data.clips < 8 || inspected.data.assets < 7 || inspected.data.scenes < 4) {
    throw new Error(`proyecto incompleto: ${JSON.stringify(inspected.data)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        clips: inspected.data.clips,
        assets: inspected.data.assets,
        scenes: inspected.data.scenes,
        durationSeconds: inspected.data.durationSeconds,
        titleClip: title.data.clipId,
        voiceClip,
        musicClip,
        motionPath: motionPath.data,
        animation: animated.data.animation,
        render: {
          jobId: started.data.jobId,
          elapsedMs: finished.elapsedMs,
          output: finished.outputPath,
          bytes: finished.outputBytes,
          width: video.width,
          height: video.height,
          fps: video.r_frame_rate,
          duration: probe.format.duration,
          codecs: streams.map((stream) => stream.codec_name),
        },
        frameHashes: hashes,
        fullDecode: { video: true, audio: true, decodedFrames, expectedFrames },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-integral falló: ${error.message}`);
  process.exitCode = 1;
}
