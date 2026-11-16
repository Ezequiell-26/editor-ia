/**
 * GENERADO por `packages/effect-kit/scripts/generate-concat.ts` — NO EDITAR A MANO.
 *
 * Efectos de audio del catálogo vendorado `concat-effects`
 * (`vendor/concat/crates/concat-effects/packages/`). Cada manifiesto es la
 * cadena FFmpeg que el paquete declara, con sus `let` ya inlineados en los
 * slots `{...}`. `audio.concatTemplate` le dice al compilador que use el
 * evaluador de expresiones de `concat-expr.ts` (port de
 * `vendor/concat/crates/concat-effects/src/expr.rs`).
 *
 * En export, Rust no usa esta tabla: resuelve las mismas cadenas con el
 * propio crate `concat-effects` (`Catalogue::ffmpeg_fragment`), así que la
 * fuente de verdad del DSP es el vendor, no este archivo.
 */

import type { EffectManifest, ParamSpec } from '../types.ts';

const AUDIO_DEFS: readonly {
  readonly manifest: EffectManifest;
  readonly fixtures: readonly {
    readonly name: string;
    readonly at: 'default' | 'min' | 'max';
    readonly params: Readonly<Record<string, number>>;
    readonly chain: string;
  }[];
}[] = [
  {
    manifest: {
          "id": "concat.bass",
          "name": "Bass",
          "category": "utility",
          "kind": "audio",
          "description": "More low end.",
          "keywords": [
                "bass",
                "tone",
                "concat",
                "bass"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "gain",
                      "label": "Gain",
                      "min": 0,
                      "max": 12,
                      "default": 5,
                      "step": 0.5,
                      "unit": "dB"
                }
          ],
          "audio": {
                "chain": [
                      "bass=g={fixed(gain, 2)}:f=110:w=0.6,alimiter=limit=0.95"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 120
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "bass=g=5.00:f=110:w=0.6,alimiter=limit=0.95",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "bass=g=0.00:f=110:w=0.6,alimiter=limit=0.95",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "bass=g=12.00:f=110:w=0.6,alimiter=limit=0.95",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.bright",
          "name": "Bright",
          "category": "utility",
          "kind": "audio",
          "description": "Air and presence: a lift above six kilohertz.",
          "keywords": [
                "bright",
                "tone",
                "concat",
                "bright"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "gain",
                      "label": "Gain",
                      "min": 0,
                      "max": 12,
                      "default": 5,
                      "step": 0.5,
                      "unit": "dB"
                }
          ],
          "audio": {
                "chain": [
                      "treble=g={fixed(gain, 2)}:f=6000:w=0.8,alimiter=limit=0.95"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 122
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "treble=g=5.00:f=6000:w=0.8,alimiter=limit=0.95",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "treble=g=0.00:f=6000:w=0.8,alimiter=limit=0.95",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "treble=g=12.00:f=6000:w=0.8,alimiter=limit=0.95",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.cathedral",
          "name": "Cathedral",
          "category": "space",
          "kind": "audio",
          "description": "Stone and height: reflections that take a while to arrive.",
          "keywords": [
                "cathedral",
                "space",
                "concat",
                "cathedral"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "size",
                      "label": "Size",
                      "min": 0,
                      "max": 100,
                      "default": 55,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.9:{round(120 * (0.5 + (size / 100) * 1.5))}|{round(230 * (0.5 + (size / 100) * 1.5))}|{round(390 * (0.5 + (size / 100) * 1.5))}|{round(600 * (0.5 + (size / 100) * 1.5))}:0.6|0.5|0.4|0.3"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 134
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.9:159|305|517|795:0.6|0.5|0.4|0.3",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.9:60|115|195|300:0.6|0.5|0.4|0.3",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.9:240|460|780|1200:0.6|0.5|0.4|0.3",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.chipmunk",
          "name": "Chipmunk",
          "category": "voice",
          "kind": "audio",
          "description": "Higher and squeakier.",
          "keywords": [
                "chipmunk",
                "voice",
                "concat",
                "chipmunk"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "pitch",
                      "label": "Pitch",
                      "min": 3,
                      "max": 12,
                      "default": 7,
                      "step": 0.5,
                      "unit": "st"
                }
          ],
          "audio": {
                "chain": [
                      "aresample=48000,asetrate={fixed(48000 * (pow(2, pitch / 12)), 6)},aresample=48000,atempo={fixed(1 / (pow(2, pitch / 12)), 8)},highpass=f=120,alimiter=limit=0.94"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 112
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aresample=48000,asetrate=71918.739690,aresample=48000,atempo=0.66741993,highpass=f=120,alimiter=limit=0.94",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aresample=48000,asetrate=57081.941520,aresample=48000,atempo=0.84089642,highpass=f=120,alimiter=limit=0.94",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aresample=48000,asetrate=96000.000000,aresample=48000,atempo=0.50000000,highpass=f=120,alimiter=limit=0.94",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.deep",
          "name": "Deep",
          "category": "voice",
          "kind": "audio",
          "description": "Lower and fuller.",
          "keywords": [
                "deep",
                "voice",
                "concat",
                "deep"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "pitch",
                      "label": "Pitch",
                      "min": -8,
                      "max": -1,
                      "default": -3,
                      "step": 0.5,
                      "unit": "st"
                },
                {
                      "type": "float",
                      "id": "body",
                      "label": "Body",
                      "min": 0,
                      "max": 8,
                      "default": 3,
                      "step": 0.5,
                      "unit": "dB"
                }
          ],
          "audio": {
                "chain": [
                      "aresample=48000,asetrate={fixed(48000 * (pow(2, pitch / 12)), 6)},aresample=48000,atempo={fixed(1 / (pow(2, pitch / 12)), 8)},highpass=f=55,equalizer=f=140:t=q:w=1.0:g={fixed(body, 2)},equalizer=f=2600:t=q:w=0.9:g=-1.2,alimiter=limit=0.94:attack=5:release=60"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 111
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aresample=48000,asetrate=40363.027932,aresample=48000,atempo=1.18920712,highpass=f=55,equalizer=f=140:t=q:w=1.0:g=3.00,equalizer=f=2600:t=q:w=0.9:g=-1.2,alimiter=limit=0.94:attack=5:release=60",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aresample=48000,asetrate=30238.105197,aresample=48000,atempo=1.58740105,highpass=f=55,equalizer=f=140:t=q:w=1.0:g=0.00,equalizer=f=2600:t=q:w=0.9:g=-1.2,alimiter=limit=0.94:attack=5:release=60",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aresample=48000,asetrate=45305.967009,aresample=48000,atempo=1.05946309,highpass=f=55,equalizer=f=140:t=q:w=1.0:g=8.00,equalizer=f=2600:t=q:w=0.9:g=-1.2,alimiter=limit=0.94:attack=5:release=60",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.denoise",
          "name": "Noise Reduction",
          "category": "utility",
          "kind": "audio",
          "description": "Takes the hum and hiss out from under the voice.",
          "keywords": [
                "noise reduction",
                "clean",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "strength",
                      "label": "Strength",
                      "min": 0,
                      "max": 100,
                      "default": 50,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "afftdn=nf={fixed(0 - 20 - strength / 100 * 30, 1)}:nr={fixed(6 + strength / 100 * 30, 1)}"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 141
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "afftdn=nf=-35.0:nr=21.0",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "afftdn=nf=-20.0:nr=6.0",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "afftdn=nf=-50.0:nr=36.0",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.distorted",
          "name": "Distorted",
          "category": "utility",
          "kind": "audio",
          "description": "Driven hard and clipped.",
          "keywords": [
                "distorted",
                "tone",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "drive",
                      "label": "Drive",
                      "min": 0,
                      "max": 100,
                      "default": 50,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "volume={fixed(1 + drive / 100 * 7, 2)},acrusher=bits=6:mode=lin:mix={fixed(drive / 100 * 0.7, 2)},alimiter=limit=0.85:level=false"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 126
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "volume=4.50,acrusher=bits=6:mode=lin:mix=0.35,alimiter=limit=0.85:level=false",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "volume=1.00,acrusher=bits=6:mode=lin:mix=0.00,alimiter=limit=0.85:level=false",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "volume=8.00,acrusher=bits=6:mode=lin:mix=0.70,alimiter=limit=0.85:level=false",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.echo",
          "name": "Echo",
          "category": "space",
          "kind": "audio",
          "description": "One repeat, fading.",
          "keywords": [
                "echo",
                "space",
                "concat",
                "echo"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "delay",
                      "label": "Delay",
                      "min": 0.05,
                      "max": 1,
                      "default": 0.25,
                      "step": 0.05,
                      "unit": "s"
                },
                {
                      "type": "float",
                      "id": "decay",
                      "label": "Decay",
                      "min": 0.1,
                      "max": 0.9,
                      "default": 0.4,
                      "step": 0.05
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.85:{round(delay * 1000)}:{fixed(decay, 2)}"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 130
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.85:250:0.40",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.85:50:0.10",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.85:1000:0.90",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.enhance-voice",
          "name": "Enhance Voice",
          "category": "utility",
          "kind": "audio",
          "description": "Clears the room out of a recording: rumble, hiss, sibilance and uneven level.",
          "keywords": [
                "enhance voice",
                "clean",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "amount",
                      "label": "Amount",
                      "min": 0,
                      "max": 100,
                      "default": 60,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=80,afftdn=nf={fixed(0 - 25 - amount / 100 * 20, 1)}:nr={fixed(6 + amount / 100 * 18, 1)},deesser=i={fixed(amount / 100 * 0.5, 2)},acompressor=threshold={fixed(0.5 - amount / 100 * 0.3, 2)}:ratio={fixed(2 + amount / 100 * 2, 1)}:attack=15:release=120,alimiter=limit=0.95"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 142
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=80,afftdn=nf=-37.0:nr=16.8,deesser=i=0.30,acompressor=threshold=0.32:ratio=3.2:attack=15:release=120,alimiter=limit=0.95",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=80,afftdn=nf=-25.0:nr=6.0,deesser=i=0.00,acompressor=threshold=0.50:ratio=2.0:attack=15:release=120,alimiter=limit=0.95",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=80,afftdn=nf=-45.0:nr=24.0,deesser=i=0.50,acompressor=threshold=0.20:ratio=4.0:attack=15:release=120,alimiter=limit=0.95",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.hall",
          "name": "Hall",
          "category": "space",
          "kind": "audio",
          "description": "A concert hall: long, even reflections.",
          "keywords": [
                "hall",
                "space",
                "concat",
                "hall"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "size",
                      "label": "Size",
                      "min": 0,
                      "max": 100,
                      "default": 50,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.85:{round(60 * (0.5 + (size / 100) * 1.5))}|{round(110 * (0.5 + (size / 100) * 1.5))}|{round(180 * (0.5 + (size / 100) * 1.5))}|{round(270 * (0.5 + (size / 100) * 1.5))}:0.5|0.4|0.3|0.2"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 132
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.85:75|138|225|338:0.5|0.4|0.3|0.2",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.85:30|55|90|135:0.5|0.4|0.3|0.2",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.85:120|220|360|540:0.5|0.4|0.3|0.2",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.lofi",
          "name": "Lo-fi",
          "category": "utility",
          "kind": "audio",
          "description": "A small old speaker: no top end, and a grain to the sound.",
          "keywords": [
                "lo-fi",
                "tone",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "bits",
                      "label": "Bits",
                      "min": 4,
                      "max": 12,
                      "default": 8,
                      "step": 1
                }
          ],
          "audio": {
                "chain": [
                      "lowpass=f=3200,acrusher=bits={round(bits)}:mode=log:mix=0.8,alimiter=limit=0.9"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 125
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "lowpass=f=3200,acrusher=bits=8:mode=log:mix=0.8,alimiter=limit=0.9",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "lowpass=f=3200,acrusher=bits=4:mode=log:mix=0.8,alimiter=limit=0.9",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "lowpass=f=3200,acrusher=bits=12:mode=log:mix=0.8,alimiter=limit=0.9",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.loudness",
          "name": "Normalize Loudness",
          "category": "utility",
          "kind": "audio",
          "description": "Brings the whole clip to one loudness, the way broadcast and the platforms expect.",
          "keywords": [
                "normalize loudness",
                "clean",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "target",
                      "label": "Target",
                      "min": -30,
                      "max": -12,
                      "default": -23,
                      "step": 1,
                      "unit": "dB"
                }
          ],
          "audio": {
                "chain": [
                      "loudnorm=I={fixed(target, 1)}:TP=-1.5:LRA=11"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 140
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "loudnorm=I=-23.0:TP=-1.5:LRA=11",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "loudnorm=I=-30.0:TP=-1.5:LRA=11",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "loudnorm=I=-12.0:TP=-1.5:LRA=11",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.megaphone",
          "name": "Megaphone",
          "category": "voice",
          "kind": "audio",
          "description": "Harsh, mid-focused projection from a handheld megaphone.",
          "keywords": [
                "megaphone",
                "voice",
                "concat",
                "bullhorn",
                "loudspeaker"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "drive",
                      "label": "Drive",
                      "min": 1,
                      "max": 10,
                      "default": 5,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=550,lowpass=f=2800,equalizer=f=1600:t=q:w=2.0:g={fixed(3 + drive * 0.8, 2)},alimiter=limit=0.88"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 115
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=550,lowpass=f=2800,equalizer=f=1600:t=q:w=2.0:g=7.00,alimiter=limit=0.88",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=550,lowpass=f=2800,equalizer=f=1600:t=q:w=2.0:g=3.80,alimiter=limit=0.88",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=550,lowpass=f=2800,equalizer=f=1600:t=q:w=2.0:g=11.00,alimiter=limit=0.88",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.pitch",
          "name": "Pitch",
          "category": "voice",
          "kind": "audio",
          "description": "Up or down by semitones, the length untouched.",
          "keywords": [
                "pitch",
                "voice",
                "concat"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "semitones",
                      "label": "Semitones",
                      "min": -12,
                      "max": 12,
                      "default": 0,
                      "step": 0.5,
                      "unit": "st"
                }
          ],
          "audio": {
                "chain": [
                      "aresample=48000,asetrate={fixed(48000 * (pow(2, semitones / 12)), 6)},aresample=48000,atempo={fixed(1 / (pow(2, semitones / 12)), 8)}"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 110
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aresample=48000,asetrate=48000.000000,aresample=48000,atempo=1.00000000",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aresample=48000,asetrate=24000.000000,aresample=48000,atempo=2.00000000",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aresample=48000,asetrate=96000.000000,aresample=48000,atempo=0.50000000",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.plate",
          "name": "Plate",
          "category": "space",
          "kind": "audio",
          "description": "A studio plate: dense, bright and short.",
          "keywords": [
                "plate",
                "space",
                "concat",
                "plate"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "size",
                      "label": "Size",
                      "min": 0,
                      "max": 100,
                      "default": 40,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.9:{round(8 * (0.5 + (size / 100) * 1.5))}|{round(17 * (0.5 + (size / 100) * 1.5))}|{round(29 * (0.5 + (size / 100) * 1.5))}|{round(43 * (0.5 + (size / 100) * 1.5))}:0.45|0.35|0.25|0.15"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 133
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.9:9|19|32|47:0.45|0.35|0.25|0.15",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.9:4|9|15|22:0.45|0.35|0.25|0.15",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.9:16|34|58|86:0.45|0.35|0.25|0.15",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.radio",
          "name": "Radio",
          "category": "utility",
          "kind": "audio",
          "description": "A small speaker on a long wave: narrow band, a little crunch.",
          "keywords": [
                "radio",
                "tone",
                "concat",
                "radio"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "noise",
                      "label": "Noise",
                      "min": 0,
                      "max": 100,
                      "default": 30,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=300,lowpass=f=3400,acrusher=bits={round((16 - (noise / 100) * 12))}:mode=log:mix=0.6,alimiter=limit=0.9"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 124
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=300,lowpass=f=3400,acrusher=bits=12:mode=log:mix=0.6,alimiter=limit=0.9",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=300,lowpass=f=3400,acrusher=bits=16:mode=log:mix=0.6,alimiter=limit=0.9",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=300,lowpass=f=3400,acrusher=bits=4:mode=log:mix=0.6,alimiter=limit=0.9",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.robot",
          "name": "Robot",
          "category": "voice",
          "kind": "audio",
          "description": "A metallic, modulated voice.",
          "keywords": [
                "robot",
                "voice",
                "concat",
                "robot"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "depth",
                      "label": "Depth",
                      "min": 1,
                      "max": 10,
                      "default": 5,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "aphaser=type=t:speed={fixed(0.4 + (depth / 10) * 1.6, 2)}:decay=0.6,flanger=delay=2:depth=4:speed=0.8,equalizer=f=1800:t=q:w=1.2:g=3,alimiter=limit=0.94"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 113
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aphaser=type=t:speed=1.20:decay=0.6,flanger=delay=2:depth=4:speed=0.8,equalizer=f=1800:t=q:w=1.2:g=3,alimiter=limit=0.94",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aphaser=type=t:speed=0.56:decay=0.6,flanger=delay=2:depth=4:speed=0.8,equalizer=f=1800:t=q:w=1.2:g=3,alimiter=limit=0.94",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aphaser=type=t:speed=2.00:decay=0.6,flanger=delay=2:depth=4:speed=0.8,equalizer=f=1800:t=q:w=1.2:g=3,alimiter=limit=0.94",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.room",
          "name": "Room",
          "category": "space",
          "kind": "audio",
          "description": "The early reflections of a room.",
          "keywords": [
                "room",
                "space",
                "concat",
                "room"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "size",
                      "label": "Size",
                      "min": 0,
                      "max": 100,
                      "default": 40,
                      "step": 1,
                      "unit": "%"
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.88:{round(23 * (0.4 + (size / 100) * 1.6))}|{round(41 * (0.4 + (size / 100) * 1.6))}|{round(67 * (0.4 + (size / 100) * 1.6))}|{round(97 * (0.4 + (size / 100) * 1.6))}:0.320|0.240|0.170|0.110"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 131
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.88:24|43|70|101:0.320|0.240|0.170|0.110",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.88:9|16|27|39:0.320|0.240|0.170|0.110",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.88:46|82|134|194:0.320|0.240|0.170|0.110",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.stadium",
          "name": "Stadium",
          "category": "space",
          "kind": "audio",
          "description": "Vast stadium echoes and reverberations across a massive arena.",
          "keywords": [
                "stadium",
                "space",
                "concat",
                "arena"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "size",
                      "label": "Size",
                      "min": 1,
                      "max": 10,
                      "default": 6,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "aecho=0.8:0.88:{round(120 + size * 18)}|{round(240 + size * 36)}:0.45|0.28,lowpass=f=6500"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 135
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aecho=0.8:0.88:228|456:0.45|0.28,lowpass=f=6500",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aecho=0.8:0.88:138|276:0.45|0.28,lowpass=f=6500",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aecho=0.8:0.88:300|600:0.45|0.28,lowpass=f=6500",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.sweet",
          "name": "Sweet",
          "category": "voice",
          "kind": "audio",
          "description": "A brighter, lighter, closer voice. Pitch at 0 follows the amount.",
          "keywords": [
                "sweet",
                "voice",
                "concat",
                "sweet"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "amount",
                      "label": "Amount",
                      "min": 0,
                      "max": 100,
                      "default": 65,
                      "step": 1,
                      "unit": "%"
                },
                {
                      "type": "float",
                      "id": "pitch",
                      "label": "Pitch",
                      "min": 0,
                      "max": 8,
                      "default": 0,
                      "step": 0.5,
                      "unit": "st"
                }
          ],
          "audio": {
                "chain": [
                      "aresample=48000,asetrate={fixed(48000 * (pow(2, (if(pitch > 0, pitch, 1.2 + 3.8 * (clamp(amount, 0, 100) / 100))) / 12)), 6)},aresample=48000,atempo={fixed(1 / (pow(2, (if(pitch > 0, pitch, 1.2 + 3.8 * (clamp(amount, 0, 100) / 100))) / 12)), 8)},highpass=f=85,equalizer=f=300:t=q:w=1.1:g=-1.4,equalizer=f=4200:t=q:w=0.8:g={fixed(0.8 + 5.2 * (clamp(amount, 0, 100) / 100), 3)},equalizer=f=10500:t=q:w=0.7:g={fixed(1.0 + 7.0 * (clamp(amount, 0, 100) / 100), 3)},compand=attacks=0.010:decays=0.180:points=-80/-80|-30/-24|-18/-13|-8/-5|0/-1.5:soft-knee=5:gain=1,deesser=i={fixed(0.18 + 0.32 * (clamp(amount, 0, 100) / 100), 3)}:m=0.45:f=0.55,aecho=0.8:0.82:38:{fixed(0.012 + 0.048 * (clamp(amount, 0, 100) / 100), 4)},alimiter=limit=0.94:attack=5:release=60"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 110
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "aresample=48000,asetrate=59334.357554,aresample=48000,atempo=0.80897480,highpass=f=85,equalizer=f=300:t=q:w=1.1:g=-1.4,equalizer=f=4200:t=q:w=0.8:g=4.180,equalizer=f=10500:t=q:w=0.7:g=5.550,compand=attacks=0.010:decays=0.180:points=-80/-80|-30/-24|-18/-13|-8/-5|0/-1.5:soft-knee=5:gain=1,deesser=i=0.388:m=0.45:f=0.55,aecho=0.8:0.82:38:0.0432,alimiter=limit=0.94:attack=5:release=60",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "aresample=48000,asetrate=51445.126202,aresample=48000,atempo=0.93303299,highpass=f=85,equalizer=f=300:t=q:w=1.1:g=-1.4,equalizer=f=4200:t=q:w=0.8:g=0.800,equalizer=f=10500:t=q:w=0.7:g=1.000,compand=attacks=0.010:decays=0.180:points=-80/-80|-30/-24|-18/-13|-8/-5|0/-1.5:soft-knee=5:gain=1,deesser=i=0.180:m=0.45:f=0.55,aecho=0.8:0.82:38:0.0120,alimiter=limit=0.94:attack=5:release=60",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "aresample=48000,asetrate=76195.250494,aresample=48000,atempo=0.62996052,highpass=f=85,equalizer=f=300:t=q:w=1.1:g=-1.4,equalizer=f=4200:t=q:w=0.8:g=6.000,equalizer=f=10500:t=q:w=0.7:g=8.000,compand=attacks=0.010:decays=0.180:points=-80/-80|-30/-24|-18/-13|-8/-5|0/-1.5:soft-knee=5:gain=1,deesser=i=0.500:m=0.45:f=0.55,aecho=0.8:0.82:38:0.0600,alimiter=limit=0.94:attack=5:release=60",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.telephone",
          "name": "Telephone",
          "category": "utility",
          "kind": "audio",
          "description": "The narrow band of a phone line.",
          "keywords": [
                "telephone",
                "tone",
                "concat",
                "telephone"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "drive",
                      "label": "Drive",
                      "min": 0,
                      "max": 10,
                      "default": 3,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=400,lowpass=f=3400,equalizer=f=1600:t=q:w=1.4:g={fixed(3 + drive / 2, 2)},alimiter=limit=0.92"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 122
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=400,lowpass=f=3400,equalizer=f=1600:t=q:w=1.4:g=4.50,alimiter=limit=0.92",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=400,lowpass=f=3400,equalizer=f=1600:t=q:w=1.4:g=3.00,alimiter=limit=0.92",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=400,lowpass=f=3400,equalizer=f=1600:t=q:w=1.4:g=8.00,alimiter=limit=0.92",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.treble",
          "name": "Treble",
          "category": "utility",
          "kind": "audio",
          "description": "More sparkle.",
          "keywords": [
                "treble",
                "tone",
                "concat",
                "treble"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "gain",
                      "label": "Gain",
                      "min": 0,
                      "max": 12,
                      "default": 4,
                      "step": 0.5,
                      "unit": "dB"
                }
          ],
          "audio": {
                "chain": [
                      "treble=g={fixed(gain, 2)}:f=9000:w=0.7,alimiter=limit=0.95"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 121
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "treble=g=4.00:f=9000:w=0.7,alimiter=limit=0.95",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "treble=g=0.00:f=9000:w=0.7,alimiter=limit=0.95",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "treble=g=12.00:f=9000:w=0.7,alimiter=limit=0.95",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.underwater",
          "name": "Underwater",
          "category": "space",
          "kind": "audio",
          "description": "Submerged beneath the surface with heavy low-pass filtering.",
          "keywords": [
                "underwater",
                "space",
                "concat",
                "submerged"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "depth",
                      "label": "Depth",
                      "min": 1,
                      "max": 10,
                      "default": 5,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "lowpass=f={fixed(800 - depth * 40, 1)},equalizer=f=200:t=q:w=2.0:g={fixed(2 + depth * 0.3, 2)},alimiter=limit=0.92"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 134
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "lowpass=f=600.0,equalizer=f=200:t=q:w=2.0:g=3.50,alimiter=limit=0.92",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "lowpass=f=760.0,equalizer=f=200:t=q:w=2.0:g=2.30,alimiter=limit=0.92",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "lowpass=f=400.0,equalizer=f=200:t=q:w=2.0:g=5.00,alimiter=limit=0.92",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.vinyl",
          "name": "Vinyl",
          "category": "utility",
          "kind": "audio",
          "description": "Warm, vintage turntable character with band-limited sound.",
          "keywords": [
                "vinyl",
                "tone",
                "concat",
                "record",
                "gramophone"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "warmth",
                      "label": "Warmth",
                      "min": 0,
                      "max": 10,
                      "default": 5,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=250,lowpass=f=5000,equalizer=f=1200:t=q:w=1.5:g={fixed(2 + warmth * 0.4, 2)},alimiter=limit=0.95"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 124
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=250,lowpass=f=5000,equalizer=f=1200:t=q:w=1.5:g=4.00,alimiter=limit=0.95",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=250,lowpass=f=5000,equalizer=f=1200:t=q:w=1.5:g=2.00,alimiter=limit=0.95",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=250,lowpass=f=5000,equalizer=f=1200:t=q:w=1.5:g=6.00,alimiter=limit=0.95",
      },
    ],
  },
  {
    manifest: {
          "id": "concat.whisper",
          "name": "Whisper",
          "category": "voice",
          "kind": "audio",
          "description": "Airy, breathy tone with attenuated low end and enhanced presence.",
          "keywords": [
                "whisper",
                "voice",
                "concat",
                "breathy",
                "intimate"
          ],
          "params": [
                {
                      "type": "float",
                      "id": "air",
                      "label": "Air",
                      "min": 1,
                      "max": 10,
                      "default": 5,
                      "step": 0.5
                }
          ],
          "audio": {
                "chain": [
                      "highpass=f=500,equalizer=f=3200:t=q:w=1.4:g={fixed(2 + air * 0.6, 2)},equalizer=f=7500:t=q:w=1.2:g={fixed(1 + air * 0.5, 2)},alimiter=limit=0.92"
                ],
                "fidelity": "exact",
                "concatTemplate": true
          },
          "order": 116
    },
    fixtures: [
      {
        name: "default",
        at: "default",
        params: {},
        chain: "highpass=f=500,equalizer=f=3200:t=q:w=1.4:g=5.00,equalizer=f=7500:t=q:w=1.2:g=3.50,alimiter=limit=0.92",
      },
      {
        name: "minimum",
        at: "min",
        params: {},
        chain: "highpass=f=500,equalizer=f=3200:t=q:w=1.4:g=2.60,equalizer=f=7500:t=q:w=1.2:g=1.50,alimiter=limit=0.92",
      },
      {
        name: "maximum",
        at: "max",
        params: {},
        chain: "highpass=f=500,equalizer=f=3200:t=q:w=1.4:g=8.00,equalizer=f=7500:t=q:w=1.2:g=6.00,alimiter=limit=0.92",
      },
    ],
  },
];

/** Efectos de audio concat listos para `ALL_EFFECTS`. */
export const CONCAT_AUDIO_EFFECTS: readonly EffectManifest[] = AUDIO_DEFS.map(
  (entry) => entry.manifest,
);

/** Cadenas FFmpeg esperadas por el vendor (`fixtures.toml`), para tests de paridad. */
export const CONCAT_AUDIO_FIXTURES: Readonly<
  Record<
    string,
    readonly {
      readonly name: string;
      readonly at: 'default' | 'min' | 'max';
      readonly params: Readonly<Record<string, number>>;
      readonly chain: string;
    }[]
  >
> = Object.fromEntries(
  AUDIO_DEFS.map((entry) => [entry.manifest.id, entry.fixtures]),
);

