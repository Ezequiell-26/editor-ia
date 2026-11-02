import { describe, expect, it } from 'vitest';
import {
  parseDecibels,
  parseOperatorCommand,
  parseSpeed,
  parseTimeToSeconds,
} from './operator';

const views = [
  { id: 'home' as const, label: 'Inicio' },
  { id: 'editor' as const, label: 'Editor' },
  { id: 'ai-hub' as const, label: 'AI Hub' },
];

describe('operador local', () => {
  it('navega por nombre y por id', () => {
    expect(parseOperatorCommand('abrir editor', views)).toMatchObject({
      kind: 'navigate',
      view: 'editor',
    });
    expect(parseOperatorCommand('ir a AI Hub', views)).toMatchObject({
      kind: 'navigate',
      view: 'ai-hub',
    });
  });

  it('reconoce controles de reproducción y proyecto', () => {
    expect(parseOperatorCommand('reproducir', views).kind).toBe('play');
    expect(parseOperatorCommand('pausar', views).kind).toBe('pause');
    expect(parseOperatorCommand('guardar', views).kind).toBe('save');
    expect(parseOperatorCommand('exportar', views).kind).toBe('export');
    expect(parseOperatorCommand('deshacer', views).kind).toBe('undo');
    expect(parseOperatorCommand('estado', views).kind).toBe('status');
    expect(parseOperatorCommand('crear un short sobre recetas', views)).toMatchObject({
      kind: 'create',
      topic: 'recetas',
    });
  });

  it('reconoce montar una carpeta de Descargas o ruta del equipo', () => {
    expect(
      parseOperatorCommand('usá los archivos de descargas de la carpeta "video 1"', views),
    ).toMatchObject({ kind: 'media_folder', folder: 'video 1' });
    expect(parseOperatorCommand('usar la carpeta video 1 de descargas', views)).toMatchObject({
      kind: 'media_folder',
      folder: 'video 1',
    });
    expect(
      parseOperatorCommand('usá los archivos de D:\\Videos\\Clips', views),
    ).toMatchObject({ kind: 'media_folder', folder: 'D:\\Videos\\Clips' });
    expect(
      parseOperatorCommand('montar carpeta "D:\\Material"', views),
    ).toMatchObject({ kind: 'media_folder', folder: 'D:\\Material' });
    expect(parseOperatorCommand('abrir carpeta vigilada', views).kind).toBe('unknown');
  });

  it('no inventa una vista desconocida', () => {
    const action = parseOperatorCommand('abrir ovnis', views);
    expect(action.kind).toBe('unknown');
  });

  it('crea títulos, lower thirds, cierres y datos sin IA', () => {
    expect(parseOperatorCommand('crear titulo Hola mundo', views)).toMatchObject({
      kind: 'motion',
      templateId: 'title-card',
      text: 'Hola mundo',
    });
    expect(parseOperatorCommand('crear título Apertura épica', views)).toMatchObject({
      kind: 'motion',
      templateId: 'title-card',
      text: 'Apertura épica',
    });
    expect(parseOperatorCommand('crear lower third Ana Pérez, Editora', views)).toMatchObject({
      kind: 'motion',
      templateId: 'lower-third',
      text: 'Ana Pérez',
      secondary: 'Editora',
    });
    expect(parseOperatorCommand('crear cierre Gracias por ver', views)).toMatchObject({
      kind: 'motion',
      templateId: 'end-card',
      text: 'Gracias por ver',
    });
    expect(parseOperatorCommand('crear dato +120%, más retención', views)).toMatchObject({
      kind: 'motion',
      templateId: 'stat-callout',
      text: '+120%',
      secondary: 'más retención',
    });
  });

  it('abre cualquier herramienta con lenguaje natural', () => {
    expect(parseOperatorCommand('quiero quitar el ruido del video', views)).toMatchObject({
      kind: 'navigate',
      view: 'denoise',
    });
    expect(parseOperatorCommand('usar la herramienta de nitidez', views)).toMatchObject({
      kind: 'navigate',
      view: 'sharpen',
    });
    expect(parseOperatorCommand('abrir compresión', views)).toMatchObject({
      kind: 'navigate',
      view: 'compress',
    });
    expect(parseOperatorCommand('quiero agrandar el video a 4k', views)).toMatchObject({
      kind: 'navigate',
      view: 'upscale',
    });
    // «abrir carpeta vigilada» no es una herramienta: sigue sin conocerse.
    expect(parseOperatorCommand('abrir carpeta vigilada', views).kind).toBe('unknown');
  });

  it('crea un proyecto con nombre', () => {
    expect(parseOperatorCommand('nueva proyecto Reel de mayo', views)).toMatchObject({
      kind: 'new_project',
      name: 'Reel de mayo',
    });
    expect(parseOperatorCommand('crear proyecto llamado "Demo IA"', views)).toMatchObject({
      kind: 'new_project',
      name: 'Demo IA',
    });
  });

  it('importa un archivo por ruta absoluta', () => {
    expect(
      parseOperatorCommand('importá el video D:\\Capturas\\toma 3.mp4', views),
    ).toMatchObject({ kind: 'import_file', path: 'D:\\Capturas\\toma 3.mp4' });
    expect(parseOperatorCommand('importar C:\\fotos\\imagen.png', views)).toMatchObject({
      kind: 'import_file',
      path: 'C:\\fotos\\imagen.png',
    });
    // Sin ruta absoluta no pasa.
    expect(parseOperatorCommand('importar clip.mp4', views).kind).toBe('unknown');
  });

  it('encola una descarga', () => {
    expect(
      parseOperatorCommand('descargar https://youtu.be/abc123', views),
    ).toMatchObject({ kind: 'download_url', url: 'https://youtu.be/abc123' });
    expect(parseOperatorCommand('bajar el video de https://x.com/a', views)).toMatchObject({
      kind: 'download_url',
      url: 'https://x.com/a',
    });
  });

  it('agrega material a la timeline por nombre', () => {
    expect(parseOperatorCommand('agregá el clip de b-roll', views)).toMatchObject({
      kind: 'add_clip',
      asset: 'b-roll',
      atPlayhead: false,
    });
    expect(parseOperatorCommand('meter el video entrevista en el playhead', views)).toMatchObject({
      kind: 'add_clip',
      asset: 'entrevista',
      atPlayhead: true,
    });
    expect(parseOperatorCommand('agregá la imagen foto 3 al final', views)).toMatchObject({
      kind: 'add_clip',
      asset: 'foto 3',
      atPlayhead: false,
    });
  });

  it('corta y borra la selección', () => {
    expect(parseOperatorCommand('cortá acá', views)).toMatchObject({
      kind: 'split_at_playhead',
    });
    expect(parseOperatorCommand('dividir el clip', views)).toMatchObject({
      kind: 'split_at_playhead',
    });
    expect(parseOperatorCommand('borrá lo seleccionado', views)).toMatchObject({
      kind: 'delete_selected',
    });
    expect(parseOperatorCommand('eliminá el subtítulo', views)).toMatchObject({
      kind: 'delete_selected',
    });
  });

  it('mueve el playhead a un tiempo dado', () => {
    expect(parseOperatorCommand('andá al segundo 90', views)).toMatchObject({
      kind: 'goto',
      seconds: 90,
    });
    expect(parseOperatorCommand('ir a 1:30', views)).toMatchObject({
      kind: 'goto',
      seconds: 90,
    });
    expect(parseOperatorCommand('ve a 2 min', views)).toMatchObject({
      kind: 'goto',
      seconds: 120,
    });
  });

  it('agrega un subtítulo en el playhead', () => {
    expect(parseOperatorCommand('subtítulo Hola mundo', views)).toMatchObject({
      kind: 'add_caption',
      text: 'Hola mundo',
      seconds: 3,
    });
    expect(
      parseOperatorCommand('agregá el subtítulo "Cierre del video" durante 5 segundos', views),
    ).toMatchObject({ kind: 'add_caption', text: 'Cierre del video', seconds: 5 });
  });

  it('cambia velocidad, volumen y silencio del clip seleccionado', () => {
    expect(parseOperatorCommand('velocidad 2x', views)).toMatchObject({
      kind: 'set_speed',
      speed: 2,
    });
    expect(parseOperatorCommand('velocidad al 50%', views)).toMatchObject({
      kind: 'set_speed',
      speed: 0.5,
    });
    expect(parseOperatorCommand('ralentizar 0,5', views)).toMatchObject({
      kind: 'set_speed',
      speed: 0.5,
    });
    expect(parseOperatorCommand('subí el volumen 3', views)).toMatchObject({
      kind: 'set_gain',
      db: 3,
    });
    expect(parseOperatorCommand('bajar volumen 5 db', views)).toMatchObject({
      kind: 'set_gain',
      db: -5,
    });
    expect(parseOperatorCommand('volumen -2', views)).toMatchObject({
      kind: 'set_gain',
      db: -2,
    });
    expect(parseOperatorCommand('silenciá el clip', views)).toMatchObject({
      kind: 'mute_clip',
      muted: true,
    });
    expect(parseOperatorCommand('quitar el silencio', views)).toMatchObject({
      kind: 'mute_clip',
      muted: false,
    });
  });

  it('los parsers numéricos no aceptan basura', () => {
    expect(parseTimeToSeconds('mucho')).toBeNull();
    expect(parseTimeToSeconds('-3')).toBeNull();
    expect(parseSpeed('mucho')).toBeNull();
    expect(parseSpeed('400%')).toBe(4);
    expect(parseDecibels('99')).toBeNull();
  });

  it('entiende relojes, minutos y segundos', () => {
    expect(parseTimeToSeconds('1:30')).toBe(90);
    expect(parseTimeToSeconds('1:02:03')).toBe(3723);
    expect(parseTimeToSeconds('2 min')).toBe(120);
    expect(parseTimeToSeconds('90s')).toBe(90);
    expect(parseTimeToSeconds('45')).toBe(45);
  });
});

describe('cerebro de edición en el operador', () => {
  it('delega en el cerebro cuando se pide cerrar huecos o mejorar el ritmo', () => {
    expect(parseOperatorCommand('cerrá los huecos', views)).toEqual({
      kind: 'brain',
      mode: 'safe',
    });
    expect(parseOperatorCommand('mejorá el ritmo del video', views)).toEqual({
      kind: 'brain',
      mode: 'safe',
    });
  });

  it('pide el diagnóstico cuando se pide analizar', () => {
    expect(parseOperatorCommand('analizá el ritmo de la timeline', views)).toEqual({
      kind: 'brain',
      mode: 'report',
    });
  });

  it('aplica todo sólo cuando se pide explícitamente', () => {
    expect(parseOperatorCommand('aplicá el cerebro completo', views)).toEqual({
      kind: 'brain',
      mode: 'all',
    });
    expect(parseOperatorCommand('usá el cerebro', views)).toEqual({
      kind: 'brain',
      mode: 'safe',
    });
  });

  it('corta los silencios del clip seleccionado por defecto', () => {
    expect(parseOperatorCommand('cortá los silencios', views)).toEqual({
      kind: 'cut_silences',
      thresholdDb: -45,
      minSilenceSeconds: 0.35,
      paddingSeconds: 0.15,
      scope: 'selection',
    });
    expect(parseOperatorCommand('limpiá los silencios del clip', views)).toMatchObject({
      kind: 'cut_silences',
      scope: 'selection',
    });
  });

  it('entiende umbral, mínimo, colchón y alcance del corte', () => {
    expect(
      parseOperatorCommand(
        'cortá los silencios de todo el proyecto con umbral -38, mínimo 0.5 s y colchón 0.2 s',
        views,
      ),
    ).toEqual({
      kind: 'cut_silences',
      thresholdDb: -38,
      minSilenceSeconds: 0.5,
      paddingSeconds: 0.2,
      scope: 'project',
    });
    expect(parseOperatorCommand('auto corte de silencio a -40 db', views)).toMatchObject({
      kind: 'cut_silences',
      thresholdDb: -40,
    });
  });

  it('no confunde desmutear con cortar silencios', () => {
    expect(parseOperatorCommand('quita el silencio', views)).toEqual({
      kind: 'mute_clip',
      muted: false,
    });
    expect(parseOperatorCommand('silenciá el clip', views)).toEqual({
      kind: 'mute_clip',
      muted: true,
    });
  });

  it('acota valores imposibles en vez de aceptarlos', () => {
    expect(parseOperatorCommand('cortá los silencios con umbral 10', views)).toMatchObject({
      thresholdDb: -10,
    });
    expect(parseOperatorCommand('cortá los silencios con umbral -200', views)).toMatchObject({
      thresholdDb: -90,
    });
  });

  it('genera subtítulos automáticos desde la voz', () => {
    expect(parseOperatorCommand('subtitulá el clip', views)).toEqual({
      kind: 'auto_subtitles',
      scope: 'selection',
    });
    expect(
      parseOperatorCommand('generá subtítulos automáticos de todo el proyecto', views),
    ).toEqual({ kind: 'auto_subtitles', scope: 'project' });
    expect(parseOperatorCommand('subtítulos automáticos', views)).toEqual({
      kind: 'auto_subtitles',
      scope: 'selection',
    });
  });

  it('no confunde el subtítulo manual con el automático', () => {
    expect(parseOperatorCommand('subtítulo hola mundo', views)).toMatchObject({
      kind: 'add_caption',
      text: 'hola mundo',
    });
    expect(parseOperatorCommand('agregá un subtítulo de cierre', views)).toMatchObject({
      kind: 'add_caption',
    });
  });

  it('corta por pausas de voz y no por amplitud', () => {
    expect(parseOperatorCommand('cortá las pausas', views)).toEqual({
      kind: 'cut_voice_pauses',
      minPauseSeconds: 0.35,
      paddingSeconds: 0.08,
      scope: 'selection',
    });
    expect(parseOperatorCommand('quitá el aire entre frases', views)).toMatchObject({
      kind: 'cut_voice_pauses',
    });
    expect(parseOperatorCommand('cortá por voz en todo el proyecto', views)).toMatchObject({
      kind: 'cut_voice_pauses',
      scope: 'project',
    });
    // El pedido de silencios sigue yendo al detector de amplitud.
    expect(parseOperatorCommand('cortá los silencios', views)).toMatchObject({
      kind: 'cut_silences',
    });
  });

  it('acepta la pausa mínima y el aire conservado', () => {
    expect(
      parseOperatorCommand('cortá las pausas con pausa mínima 0.6 s y aire 0.1 s', views),
    ).toMatchObject({
      kind: 'cut_voice_pauses',
      minPauseSeconds: 0.6,
      paddingSeconds: 0.1,
    });
  });

  it('hace la limpieza completa con valores por defecto', () => {
    expect(parseOperatorCommand('limpiá el video', views)).toEqual({
      kind: 'auto_cleanup',
      denoise: 'medium',
      levelAudio: true,
      zoomCuts: true,
      cutSilences: true,
      cutPauses: true,
      targetLufs: -14,
    });
    expect(parseOperatorCommand('dejalo listo para publicar', views)).toMatchObject({
      kind: 'auto_cleanup',
    });
  });

  it('ajusta la limpieza con lo que se pide apagar', () => {
    expect(parseOperatorCommand('limpiá el proyecto sin zoom', views)).toMatchObject({
      kind: 'auto_cleanup',
      zoomCuts: false,
    });
    expect(parseOperatorCommand('limpiá el video con denoise fuerte', views)).toMatchObject({
      kind: 'auto_cleanup',
      denoise: 'strong',
    });
    expect(parseOperatorCommand('limpiá el video sin ruido y sin nivelar', views)).toMatchObject({
      kind: 'auto_cleanup',
      denoise: 'off',
      levelAudio: false,
    });
  });

  it('reconoce el servidor MCP', () => {
    expect(parseOperatorCommand('abrí el servidor MCP', views)).toEqual({ kind: 'mcp_server' });
    expect(parseOperatorCommand('quiero conectar una IA', views)).toMatchObject({
      kind: 'mcp_server',
    });
  });

  it('no confunde limpiar el video con cortar sólo los silencios', () => {
    expect(parseOperatorCommand('limpiá los silencios', views)).toMatchObject({
      kind: 'cut_silences',
    });
  });

  it('reconoce el piloto automático completo para crear y entregar el video', () => {
    expect(parseOperatorCommand('piloto automático', views)).toEqual({
      kind: 'auto_pilot',
    });
    expect(parseOperatorCommand('auto pilot', views)).toEqual({
      kind: 'auto_pilot',
    });
    expect(parseOperatorCommand('hacé todo automático', views)).toEqual({
      kind: 'auto_pilot',
    });
    expect(parseOperatorCommand('limpiá y exportá', views)).toEqual({
      kind: 'auto_pilot',
    });
    expect(parseOperatorCommand('crear video automático', views)).toEqual({
      kind: 'auto_pilot',
    });
  });
});
