import type { AudioRecipe, EffectManifest, ParamSpec } from '../types.ts';

/**
 * Catálogo de efectos de audio.
 *
 * Misma arquitectura que el catálogo de video: cada efecto es un manifiesto con
 * parámetros tipados y una receta de export. La diferencia es el destino de la
 * receta: no entra en la cadena de video del clip sino en la de audio, y por eso
 * usa filtros de audio de FFmpeg en vez de shaders.
 *
 * Dos macros resuelven lo que una plantilla estática no puede:
 * - `%RATE%` es la frecuencia de muestreo del perfil. `asetrate` necesita un
 *   número concreto y el catálogo no conoce el perfil.
 * - `%INV:<param>%` invierte un parámetro. Un cambio de tono con `asetrate`
 *   alarga el clip; `atempo` con el inverso devuelve la duración original sin
 *   obligar al usuario a ajustar dos controles a mano.
 *
 * Todos los filtros usados existen en el FFmpeg LGPL que viaja con la app
 * (verificado contra `ffmpeg -filters` antes de escribir la receta). Los que no
 * existen —`rubberband`, por ejemplo— no se usan.
 */

type Extra = {
  readonly group?: string;
  readonly hint?: string;
  readonly unit?: string;
  readonly step?: number;
};

function f(
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  extra: Extra = {},
): ParamSpec {
  return { type: 'float', id, label, min, max, default: def, ...extra };
}

function i(id: string, label: string, min: number, max: number, def: number): ParamSpec {
  return { type: 'int', id, label, min, max, default: def };
}

function en(id: string, label: string, options: readonly string[], def: number): ParamSpec {
  return { type: 'enum', id, label, options, default: def };
}

interface AudioDef {
  readonly id: string;
  readonly name: string;
  readonly category: EffectManifest['category'];
  readonly description: string;
  readonly keywords: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly chain: readonly string[];
  readonly fidelity?: AudioRecipe['fidelity'];
  readonly note?: string;
}

const DEFS: readonly AudioDef[] = [
  // ── Espacio ────────────────────────────────────────────────────────────────
  {
    id: 'audio.autopan',
    name: 'Autopaneo',
    category: 'space',
    description:
      'Mueve la señal de izquierda a derecha a un ritmo fijo. Sirve para dar movimiento a una cama musical sin tocar el resto de la mezcla.',
    keywords: ['pan', 'paneo', 'movimiento', 'auto', 'stereo'],
    params: [
      f('rate', 'Velocidad', 0.05, 8, 0.8, { unit: 'Hz', step: 0.05 }),
      f('depth', 'Profundidad', 0, 1, 0.9, { step: 0.01 }),
    ],
    chain: ['apulsator=hz={rate}:amount={depth}:mode=triangle'],
  },
  {
    id: 'audio.chorus',
    name: 'Coro',
    category: 'space',
    description:
      'Duplica la señal con retardos desafinados y cortos. Engorda voces e instrumentos sin que suenen dobles.',
    keywords: ['chorus', 'coro', 'dobla', 'ancho', 'voz'],
    params: [
      f('delay', 'Retardo base', 40, 100, 55, { unit: 'ms', step: 1 }),
      f('speed', 'Velocidad', 0.1, 5, 0.4, { unit: 'Hz', step: 0.05 }),
      f('depth', 'Profundidad', 0.5, 8, 2.5, { step: 0.1 }),
    ],
    chain: ['chorus=0.6:0.9:{delay}:0.35:{speed}:{depth}'],
  },
  {
    id: 'audio.echo',
    name: 'Eco',
    category: 'space',
    description:
      'Repite la señal con caída progresiva. Un eco largo separa frases; uno corto la pega a la sala.',
    keywords: ['echo', 'eco', 'reverb', 'repeticion', 'sala'],
    params: [
      f('delay', 'Retardo', 20, 2000, 350, { unit: 'ms', step: 5 }),
      f('decay', 'Caída', 0, 0.9, 0.4, { step: 0.01 }),
    ],
    chain: ['aecho=0.8:0.9:{delay}:{decay}'],
  },
  {
    id: 'audio.flanger',
    name: 'Flanger',
    category: 'space',
    description:
      'Barre un retardo muy corto y crea un peine móvil. El clásico efecto de jet que atraviesa la señal.',
    keywords: ['flanger', 'jet', 'barrido', 'peine', 'modulacion'],
    params: [
      f('delay', 'Retardo', 0, 20, 2, { unit: 'ms', step: 0.5 }),
      f('depth', 'Profundidad', 0, 10, 3, { step: 0.1 }),
      f('regen', 'Realimentación', -95, 95, 40, { unit: '%', step: 1 }),
      f('width', 'Mezcla', 0, 100, 70, { unit: '%', step: 1 }),
      f('speed', 'Velocidad', 0.1, 5, 0.4, { unit: 'Hz', step: 0.05 }),
    ],
    chain: ['flanger=delay={delay}:depth={depth}:regen={regen}:width={width}:speed={speed}'],
  },
  {
    id: 'audio.phaser',
    name: 'Phaser',
    category: 'space',
    description:
      'Desplaza la fase por bandas y barre el desfase. Más suave que el flanger, ideal para pads y guitarras.',
    keywords: ['phaser', 'fase', 'barrido', 'modulacion', 'suave'],
    params: [
      f('delay', 'Retardo', 0, 5, 3, { unit: 'ms', step: 0.1 }),
      f('decay', 'Caída', 0, 0.99, 0.4, { step: 0.01 }),
      f('speed', 'Velocidad', 0.1, 2, 0.5, { unit: 'Hz', step: 0.05 }),
      en('type', 'Forma', ['sinusoidal', 'triangular'], 1),
    ],
    chain: ['aphaser=in_gain=0.4:out_gain=0.74:delay={delay}:decay={decay}:speed={speed}:type={type}'],
  },
  {
    id: 'audio.slapback',
    name: 'Slapback',
    category: 'space',
    description:
      'Un solo rebote corto y seco. Es el eco de rockabilly: separa la voz sin llenarla de cola.',
    keywords: ['slapback', 'rebote', 'rockabilly', 'corto', 'voz'],
    params: [
      f('delay', 'Retardo', 40, 260, 120, { unit: 'ms', step: 1 }),
      f('decay', 'Caída', 0, 0.7, 0.35, { step: 0.01 }),
    ],
    chain: ['aecho=0.85:0.85:{delay}:{decay}'],
  },
  {
    id: 'audio.tremolo',
    name: 'Trémolo',
    category: 'space',
    description:
      'Modula el volumen a un ritmo regular. Da pulso a pads y tensión a escenas de suspenso.',
    keywords: ['tremolo', 'pulso', 'volumen', 'modulacion', 'ritmo'],
    params: [
      f('rate', 'Velocidad', 0.1, 20, 5, { unit: 'Hz', step: 0.1 }),
      f('depth', 'Profundidad', 0, 1, 0.5, { step: 0.01 }),
    ],
    chain: ['tremolo=f={rate}:d={depth}'],
  },
  {
    id: 'audio.widen',
    name: 'Ensanche estéreo',
    category: 'space',
    description:
      'Separa los canales para abrir la imagen. Con monofuentes muy anchas conviene moderarlo: el centro se debilita.',
    keywords: ['stereo', 'ancho', 'imagen', 'widen', 'amplitud'],
    params: [f('width', 'Ancho', 0, 4, 2, { step: 0.05 })],
    chain: ['extrastereo=m={width}'],
  },

  // ── Textura ────────────────────────────────────────────────────────────────
  {
    id: 'audio.bitcrush',
    name: 'Bitcrush',
    category: 'texture',
    description:
      'Reduce la resolución de bits y la tasa de muestreo. Suciedad digital controlada, de lo sutil al caos.',
    keywords: ['bitcrush', 'digital', 'sucio', 'lofi', 'reduccion'],
    params: [
      f('bits', 'Bits', 1, 16, 8, { step: 1 }),
      f('mix', 'Mezcla', 0, 1, 0.8, { step: 0.01 }),
      i('downsample', 'Submuestreo', 1, 16, 1),
    ],
    chain: ['acrusher=bits={bits}:mix={mix}:mode=log:aa=0.6:samples={downsample}'],
  },
  {
    id: 'audio.crystal',
    name: 'Cristal',
    category: 'texture',
    description:
      'Excita los armónicos altos para dar aire y brillo. En exceso cansa; en dosis pequeña abre una voz opaca.',
    keywords: ['crystal', 'brillo', 'aire', 'armonicos', 'excitador'],
    params: [
      f('amount', 'Cantidad', 0, 10, 2.5, { step: 0.1 }),
      f('drive', 'Armónicos', 0.1, 10, 8.5, { step: 0.1 }),
      f('blend', 'Balance', -10, 10, 0, { step: 0.1 }),
      f('freq', 'Desde', 2000, 12000, 7500, { unit: 'Hz', step: 100 }),
    ],
    chain: ['aexciter=amount={amount}:drive={drive}:blend={blend}:freq={freq}:ceil=18000'],
  },
  {
    id: 'audio.eightbit',
    name: '8 bits',
    category: 'texture',
    description:
      'Baja la señal a 8 kHz y la trunca a pocos bits. El sonido de consola de los ochenta, sin samples.',
    keywords: ['8bit', 'consola', 'retro', 'videojuego', 'lofi'],
    params: [f('bits', 'Bits', 2, 8, 5, { step: 1 })],
    chain: ['aresample=8000,acrusher=bits={bits}:mix=1:mode=log,aresample=%RATE%'],
  },
  {
    id: 'audio.tape',
    name: 'Cinta',
    category: 'texture',
    description:
      'Corte de agudos, wow lento y compresión suave. La huella de un casete sin ruido de superficie.',
    keywords: ['tape', 'cinta', 'casete', 'wow', 'analogo'],
    params: [
      f('cutoff', 'Corte de agudos', 4000, 14000, 9000, { unit: 'Hz', step: 100 }),
      f('wow', 'Wow', 0.1, 2, 0.6, { unit: 'Hz', step: 0.05 }),
      f('flutter', 'Flutter', 0, 1, 0.12, { step: 0.01 }),
    ],
    chain: [
      'highpass=f=55,lowpass=f={cutoff},vibrato=f={wow}:d={flutter},acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120',
    ],
  },
  {
    id: 'audio.vinyl',
    name: 'Vinilo',
    category: 'texture',
    description:
      'Recorta extremos, reduce bits y realza la presencia. Aproxima un disco gastado sin sample de ruido.',
    keywords: ['vinyl', 'vinilo', 'disco', 'crujido', 'retro'],
    params: [
      f('cutoff', 'Corte de agudos', 3000, 12000, 7000, { unit: 'Hz', step: 100 }),
      f('bits', 'Bits', 6, 16, 10, { step: 1 }),
      f('crackle', 'Crujido', 0, 1, 0.18, { step: 0.01 }),
      f('presence', 'Presencia', -6, 6, 1.5, { unit: 'dB', step: 0.1 }),
    ],
    chain: [
      'highpass=f=70,lowpass=f={cutoff},acrusher=bits={bits}:mix={crackle}:mode=lin,equalizer=f=2500:t=q:w=1.2:g={presence}',
    ],
    fidelity: 'approximate',
    note: 'el crujido se aproxima con reducción de bits; no hay ruido de superficie real',
  },

  // ── Transmisión ────────────────────────────────────────────────────────────
  {
    id: 'audio.megaphone',
    name: 'Megáfono',
    category: 'transmission',
    description:
      'Banda angosta, compresión dura y saturación. La voz de un altavoz de estadio o de una protesta.',
    keywords: ['megafono', 'altavoz', 'estadio', 'distorsion', 'voz'],
    params: [f('drive', 'Saturación', 0, 18, 6, { unit: 'dB', step: 0.5 })],
    chain: [
      'highpass=f=600,lowpass=f=3200,acompressor=threshold=-22dB:ratio=8:attack=2:release=40,volume={drive}dB,aexciter=amount=2:drive=9:freq=6000',
    ],
  },
  {
    id: 'audio.muffled',
    name: 'Amortiguado',
    category: 'transmission',
    description:
      'Corta los agudos como si la fuente estuviera detrás de una pared o de una puerta cerrada.',
    keywords: ['amortiguado', 'sordo', 'pared', 'puerta', 'apagado'],
    params: [
      f('cutoff', 'Corte', 250, 4000, 800, { unit: 'Hz', step: 10 }),
      f('level', 'Nivel', -6, 6, 0, { unit: 'dB', step: 0.5 }),
    ],
    chain: ['lowpass=f={cutoff}:poles=2,volume={level}dB'],
  },
  {
    id: 'audio.telephone',
    name: 'Teléfono',
    category: 'transmission',
    description:
      'Banda de 300 a 3400 Hz con compresión. La voz de una llamada, sin música ni graves.',
    keywords: ['telefono', 'llamada', 'banda', 'radio', 'voz'],
    params: [
      f('low', 'Corte grave', 200, 800, 350, { unit: 'Hz', step: 10 }),
      f('high', 'Corte agudo', 2000, 5000, 3200, { unit: 'Hz', step: 50 }),
    ],
    chain: ['highpass=f={low},lowpass=f={high},acompressor=threshold=-18dB:ratio=4:attack=5:release=80'],
  },
  {
    id: 'audio.underwater',
    name: 'Bajo el agua',
    category: 'transmission',
    description:
      'Graves dominantes, rebote corto y oscilación lenta. La escucha subjetiva de alguien sumergido.',
    keywords: ['agua', 'submarino', 'sumergido', 'grave', 'wobble'],
    params: [
      f('cutoff', 'Corte', 300, 1500, 500, { unit: 'Hz', step: 10 }),
      f('wobble', 'Oscilación', 0.5, 4, 1.4, { unit: 'Hz', step: 0.1 }),
    ],
    chain: ['lowpass=f={cutoff},aecho=0.7:0.6:60:0.3,vibrato=f={wobble}:d=0.35'],
  },
  {
    id: 'audio.walkie',
    name: 'Walkie-talkie',
    category: 'transmission',
    description:
      'Banda estrecha, compresión y grano digital. Comunicación de radio de campo.',
    keywords: ['walkie', 'radio', 'campo', 'digital', 'voz'],
    params: [
      f('bits', 'Bits', 6, 14, 9, { step: 1 }),
      f('grit', 'Grano', 0, 1, 0.35, { step: 0.01 }),
    ],
    chain: [
      'highpass=f=450,lowpass=f=2600,acompressor=threshold=-20dB:ratio=6:attack=3:release=60,acrusher=bits={bits}:mix={grit}:mode=log',
    ],
  },

  // ── Utilería ───────────────────────────────────────────────────────────────
  {
    id: 'audio.compressor',
    name: 'Compresor',
    category: 'utility',
    description:
      'Reduce el rango dinámico para que la voz no se pierda bajo la música. El control de mezcla más usado después del fader.',
    keywords: ['compresor', 'dinamica', 'nivel', 'voz', 'mezcla'],
    params: [
      f('threshold', 'Umbral', -40, 0, -18, { unit: 'dB', step: 0.5 }),
      f('ratio', 'Ratio', 1, 20, 4, { step: 0.1 }),
      f('attack', 'Ataque', 0.01, 200, 5, { unit: 'ms', step: 0.1 }),
      f('release', 'Liberación', 10, 2000, 120, { unit: 'ms', step: 5 }),
      f('makeup', 'Ganancia de salida', 0, 24, 0, { unit: 'dB', step: 0.5 }),
    ],
    chain: [
      'acompressor=threshold={threshold}dB:ratio={ratio}:attack={attack}:release={release}:makeup={makeup}dB',
    ],
  },
  {
    id: 'audio.deesser',
    name: 'De-esser',
    category: 'utility',
    description:
      'Baja las eses y las chasquidos. La diferencia entre una voz profesional y una que pica en los agudos.',
    keywords: ['deesser', 'eses', 'sibilancia', 'voz', 'agudos'],
    params: [
      f('intensity', 'Intensidad', 0, 1, 0.5, { step: 0.01 }),
      f('max', 'Máximo', 0, 1, 0.5, { step: 0.01 }),
      f('freq', 'Frecuencia', 0, 1, 0.5, { step: 0.01 }),
    ],
    chain: ['deesser=i={intensity}:m={max}:f={freq}'],
  },
  {
    id: 'audio.eq',
    name: 'EQ de dos bandas',
    category: 'utility',
    description:
      'Graves y agudos con frecuencia ajustable. La corrección rápida antes de entrar en el mezclador.',
    keywords: ['eq', 'graves', 'agudos', 'tono', 'correccion'],
    params: [
      f('low', 'Graves', -20, 20, 0, { unit: 'dB', step: 0.5 }),
      f('lowFreq', 'Frecuencia grave', 60, 300, 120, { unit: 'Hz', step: 5 }),
      f('high', 'Agudos', -20, 20, 0, { unit: 'dB', step: 0.5 }),
      f('highFreq', 'Frecuencia aguda', 4000, 12000, 8000, { unit: 'Hz', step: 100 }),
    ],
    chain: ['bass=g={low}:f={lowFreq},treble=g={high}:f={highFreq}'],
  },
  {
    id: 'audio.gate',
    name: 'Puerta',
    category: 'utility',
    description:
      'Silencia lo que queda por debajo del umbral. Limpia respiraciones y ruido de fondo entre frases.',
    keywords: ['gate', 'puerta', 'ruido', 'silencio', 'limpieza'],
    params: [
      f('threshold', 'Umbral', 0, 1, 0.05, { step: 0.005 }),
      f('ratio', 'Ratio', 1, 20, 4, { step: 0.1 }),
      f('attack', 'Ataque', 1, 100, 10, { unit: 'ms', step: 1 }),
      f('release', 'Liberación', 50, 1000, 250, { unit: 'ms', step: 10 }),
      f('range', 'Reducción', 0, 1, 0.06, { step: 0.01 }),
    ],
    chain: [
      'agate=threshold={threshold}:ratio={ratio}:attack={attack}:release={release}:range={range}',
    ],
  },
  {
    id: 'audio.leveler',
    name: 'Nivelador',
    category: 'utility',
    description:
      'Normaliza por ventanas para emparejar tomas desparejas. Más transparente que comprimir a mano.',
    keywords: ['nivelador', 'normalizar', 'emparejar', 'dinamica', 'voz'],
    params: [
      f('frame', 'Ventana', 100, 1000, 500, { unit: 'ms', step: 10 }),
      i('gaussian', 'Suavizado', 5, 101, 31),
      f('peak', 'Pico', 0.5, 1, 0.95, { step: 0.01 }),
      f('maxGain', 'Ganancia máxima', 1, 20, 10, { step: 0.5 }),
    ],
    chain: ['dynaudnorm=f={frame}:g={gaussian}:p={peak}:m={maxGain}'],
  },
  {
    id: 'audio.limiter',
    name: 'Limitador',
    category: 'utility',
    description:
      'Techo duro con anticipación. Evita que un pico rompa la mezcla sin cambiar el carácter.',
    keywords: ['limiter', 'limitador', 'techo', 'pico', 'master'],
    params: [
      f('limit', 'Techo', 0.0625, 1, 0.89, { step: 0.01 }),
      f('attack', 'Ataque', 0.1, 80, 5, { unit: 'ms', step: 0.1 }),
      f('release', 'Liberación', 1, 800, 50, { unit: 'ms', step: 1 }),
    ],
    chain: ['alimiter=limit={limit}:attack={attack}:release={release}:level=0'],
  },

  // ── Voz ────────────────────────────────────────────────────────────────────
  {
    id: 'audio.voice_alien',
    name: 'Voz alien',
    category: 'voice',
    description:
      'Baja el tono y lo combina con un barrido de fase. Una voz que no pertenece a este planeta.',
    keywords: ['alien', 'voz', 'extraterrestre', 'tono', 'phaser'],
    params: [f('pitch', 'Tono', 0.6, 1.4, 0.82, { step: 0.01 })],
    chain: [
      'asetrate=%RATE%*{pitch},aresample=%RATE%,atempo=%INV:pitch%,aphaser=type=sinusoidal:speed=0.8',
    ],
  },
  {
    id: 'audio.voice_chipmunk',
    name: 'Voz ardilla',
    category: 'voice',
    description:
      'Sube el tono conservando la duración. El clásico efecto de dibujo animado.',
    keywords: ['chipmunk', 'ardilla', 'agudo', 'tono', 'comico'],
    params: [f('pitch', 'Tono', 1.05, 1.8, 1.32, { step: 0.01 })],
    chain: ['asetrate=%RATE%*{pitch},aresample=%RATE%,atempo=%INV:pitch%'],
  },
  {
    id: 'audio.voice_deep',
    name: 'Voz grave',
    category: 'voice',
    description:
      'Baja el tono sin alargar el clip. Narrador de documental o villano de turno.',
    keywords: ['grave', 'profundo', 'narrador', 'tono', 'voz'],
    params: [f('pitch', 'Tono', 0.5, 0.95, 0.8, { step: 0.01 })],
    chain: ['asetrate=%RATE%*{pitch},aresample=%RATE%,atempo=%INV:pitch%'],
  },
  {
    id: 'audio.voice_robot',
    name: 'Voz robot',
    category: 'voice',
    description:
      'Vibrato rápido y un rebote metálico corto. Voz sintética de androide.',
    keywords: ['robot', 'androide', 'metalico', 'vibrato', 'voz'],
    params: [
      f('rate', 'Vibración', 20, 60, 32, { unit: 'Hz', step: 1 }),
      f('depth', 'Profundidad', 0, 1, 0.45, { step: 0.01 }),
    ],
    chain: ['vibrato=f={rate}:d={depth},aecho=0.8:0.8:18:0.25'],
  },
  {
    id: 'audio.voice_vader',
    name: 'Voz oscura',
    category: 'voice',
    description:
      'Tono bajo, corte de agudos y cámara. La respiración pesada queda a cargo del actor.',
    keywords: ['vader', 'oscuro', 'villano', 'grave', 'camara'],
    params: [
      f('pitch', 'Tono', 0.6, 0.9, 0.72, { step: 0.01 }),
      f('cutoff', 'Corte', 800, 2500, 1200, { unit: 'Hz', step: 50 }),
    ],
    chain: [
      'asetrate=%RATE%*{pitch},aresample=%RATE%,atempo=%INV:pitch%,lowpass=f={cutoff},aecho=0.8:0.9:40:0.3',
    ],
  },
  {
    id: 'audio.voice_wobble',
    name: 'Voz tambaleante',
    category: 'voice',
    description:
      'Vibrato y trémolo al mismo ritmo. Voz inestable, de borrachera o de criatura.',
    keywords: ['wobble', 'tambaleo', 'vibrato', 'tremolo', 'criatura'],
    params: [
      f('rate', 'Ritmo', 3, 12, 6, { unit: 'Hz', step: 0.1 }),
      f('depth', 'Vibración', 0.2, 1, 0.6, { step: 0.01 }),
      f('trem', 'Trémolo', 0, 1, 0.25, { step: 0.01 }),
    ],
    chain: ['vibrato=f={rate}:d={depth},tremolo=f={rate}:d={trem}'],
  },
];

export const AUDIO_EFFECTS: readonly EffectManifest[] = DEFS.map((def, index) => ({
  id: def.id,
  name: def.name,
  category: def.category,
  kind: 'audio' as const,
  description: def.description,
  keywords: def.keywords,
  params: def.params,
  audio: {
    chain: def.chain,
    fidelity: def.fidelity ?? 'exact',
    ...(def.note ? { note: def.note } : {}),
  },
  order: index,
}));
