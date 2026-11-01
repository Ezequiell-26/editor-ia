import { describe, expect, it } from 'vitest';
import {
  RIG_CLIPS,
  RIG_PALETTES,
  drawRigFrame,
  rigClipById,
  rigPaletteById,
  rigPose,
  rigSkeleton,
  solveTwoBone,
  type RigClipId,
  type RigPose,
} from './rig';

const CLIP_IDS: RigClipId[] = ['idle', 'walk', 'run', 'jump', 'wave', 'reach'];
const SAMPLES = [0, 0.1, 0.25, 0.4, 0.5, 0.66, 0.75, 0.9, 1];

function angles(pose: RigPose): number[] {
  return [
    pose.lean,
    pose.thighL,
    pose.shinL,
    pose.thighR,
    pose.shinR,
    pose.armL,
    pose.elbowL,
    pose.armR,
    pose.elbowR,
    pose.headTilt,
  ];
}

function close(a: number, b: number, digits = 6): boolean {
  return Math.abs(a - b) < 10 ** -digits;
}

describe('rig 2D · catálogo', () => {
  it('define los seis clips con ciclos positivos', () => {
    expect(RIG_CLIPS.map((clip) => clip.id)).toEqual(CLIP_IDS);
    for (const clip of RIG_CLIPS) {
      expect(clip.label.length).toBeGreaterThan(0);
      expect(clip.description.length).toBeGreaterThan(0);
      expect(clip.cycleSeconds).toBeGreaterThan(0);
    }
  });

  it('resuelve clips y paletas con respaldo seguro', () => {
    expect(rigClipById('run').id).toBe('run');
    expect(rigClipById('nope' as RigClipId).id).toBe('idle');
    expect(rigPaletteById('amber').id).toBe('amber');
    expect(rigPaletteById('nope').id).toBe(RIG_PALETTES[0]!.id);
  });
});

describe('rig 2D · poses', () => {
  it('produce ángulos finitos y acotados en todos los clips', () => {
    for (const id of CLIP_IDS) {
      for (const progress of SAMPLES) {
        const pose = rigPose(id, progress);
        for (const angle of angles(pose)) {
          expect(Number.isFinite(angle)).toBe(true);
          expect(Math.abs(angle)).toBeLessThanOrEqual(1.7);
        }
        expect(pose.bob).toBeGreaterThanOrEqual(0);
        expect(pose.bob).toBeLessThanOrEqual(0.13);
      }
    }
  });

  it('la cinemática inversa alcanza el objetivo y limita el alcance', () => {
    const origin = { x: 100, y: 100 };
    const reachable = solveTwoBone(origin, { x: 160, y: 40 }, 60, 50);
    const distance = Math.hypot(reachable.hand.x - 160, reachable.hand.y - 40);
    expect(distance).toBeLessThan(1);
    expect(reachable.elbow.x).toBeGreaterThan(origin.x);
    expect(reachable.reached).toBe(true);

    const far = solveTwoBone(origin, { x: 600, y: 100 }, 60, 50);
    expect(far.reached).toBe(false);
    expect(Math.hypot(far.hand.x - origin.x, far.hand.y - origin.y)).toBeLessThan(110.1);
  });

  it('reach interpola el objetivo IK y lo acota', () => {
    const start = rigPose('reach', 0);
    const middle = rigPose('reach', 0.5);
    const end = rigPose('reach', 1);
    expect(start.ikAmount).toBeCloseTo(0, 6);
    expect(middle.ikAmount).toBeCloseTo(1, 6);
    expect(end.ikAmount).toBeCloseTo(0, 6);
    expect(middle.ikTarget).toEqual({ x: 0.82, y: 0.28 });
    const clamped = rigPose('reach', 0.5, { x: 2, y: -1 });
    expect(clamped.ikTarget).toEqual({ x: 1, y: 0 });
  });

  it('recorta progreso fuera de rango y valores no finitos', () => {
    const start = rigPose('walk', -3);
    const startAgain = rigPose('walk', 0);
    expect(close(start.thighL, startAgain.thighL)).toBe(true);
    expect(close(start.bob, startAgain.bob)).toBe(true);

    const end = rigPose('walk', 4);
    const endAgain = rigPose('walk', 1);
    expect(close(end.thighL, endAgain.thighL)).toBe(true);
    expect(close(end.armR, endAgain.armR)).toBe(true);

    const nan = rigPose('wave', Number.NaN);
    const zero = rigPose('wave', 0);
    expect(close(nan.armR, zero.armR)).toBe(true);
    const infinite = rigPose('run', Number.POSITIVE_INFINITY);
    const runZero = rigPose('run', 0);
    expect(close(infinite.thighL, runZero.thighL)).toBe(true);
  });

  it('alterna piernas y brazos en caminata y correr', () => {
    for (const id of ['walk', 'run'] as const) {
      const pose = rigPose(id, 0.25);
      expect(pose.thighL).toBeGreaterThan(0.3);
      expect(pose.thighR).toBeLessThan(-0.3);
      expect(pose.armL).toBeLessThan(0);
      expect(pose.armR).toBeGreaterThan(0);
      expect(pose.shinR).toBeGreaterThan(0);
      expect(pose.shinL).toBe(0);
    }
  });

  it('correr inclina y amplifica la zancada respecto de caminar', () => {
    const walk = rigPose('walk', 0.25);
    const run = rigPose('run', 0.25);
    expect(run.lean).toBeGreaterThan(walk.lean);
    expect(run.thighL).toBeGreaterThan(walk.thighL);
    expect(run.bob).toBeGreaterThan(walk.bob);
  });

  it('saltar eleva el cuerpo y encoge las piernas en el aire', () => {
    const grounded = rigPose('jump', 0.05);
    const air = rigPose('jump', 0.52);
    expect(air.bob).toBeGreaterThan(0.1);
    expect(air.bob).toBeGreaterThan(grounded.bob);
    expect(air.shinL).toBeGreaterThan(0.5);
    expect(air.armL).toBeLessThan(-0.5);
  });

  it('saludar levanta solo el brazo derecho', () => {
    const wave = rigPose('wave', 0.2);
    expect(wave.armR).toBeLessThan(-0.9);
    expect(Math.abs(wave.armL)).toBeLessThan(0.3);
    expect(rigPose('idle', 0.2).armR).toBeGreaterThan(-0.3);
  });
});

describe('rig 2D · esqueleto', () => {
  const pose = rigPose('idle', 0.3);

  it('centra la cadera y mantiene la cabeza arriba de los pies', () => {
    const joints = rigSkeleton(pose, 640, 360);
    expect(Math.abs(joints.hip.x - 320)).toBeLessThan(4);
    expect(joints.head.y).toBeLessThan(joints.hip.y);
    expect(joints.hip.y).toBeLessThan(joints.footL.y);
    expect(joints.footL.y).toBeLessThanOrEqual(360);
    expect(joints.neck.y).toBeLessThan(joints.hip.y);
    expect(joints.chest.y).toBeLessThan(joints.hip.y);
  });

  it('mantiene todas las articulaciones dentro del canvas', () => {
    const joints = rigSkeleton(pose, 480, 270);
    for (const point of Object.values(joints)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(480);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(270);
    }
  });

  it('separa brazos y piernas izquierda/derecha', () => {
    const joints = rigSkeleton(rigPose('walk', 0.25), 640, 360);
    expect(joints.kneeL.x).toBeGreaterThan(joints.kneeR.x);
    expect(joints.handL.x).not.toBe(joints.handR.x);
  });

  it('sanea dimensiones inválidas', () => {
    const joints = rigSkeleton(pose, Number.NaN, -10);
    for (const point of Object.values(joints)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('rig 2D · dibujo', () => {
  it('dibuja fondo, suelo, nueve huesos y cabeza', () => {
    const strokes: string[] = [];
    const fills: string[] = [];
    const arcs: { x: number; y: number }[] = [];
    const state = { fillStyle: '', strokeStyle: '' };
    const context = {
      get fillStyle() {
        return state.fillStyle;
      },
      set fillStyle(value: string) {
        state.fillStyle = value;
      },
      get strokeStyle() {
        return state.strokeStyle;
      },
      set strokeStyle(value: string) {
        state.strokeStyle = value;
      },
      lineWidth: 1,
      lineCap: 'butt',
      save() {},
      restore() {},
      clearRect() {
        fills.push('clear');
      },
      fillRect() {
        fills.push(`rect:${state.fillStyle}`);
      },
      beginPath() {},
      ellipse() {},
      arc(x: number, y: number) {
        arcs.push({ x, y });
      },
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes.push(state.strokeStyle);
      },
      fill() {
        fills.push(`fill:${state.fillStyle}`);
      },
    } as unknown as CanvasRenderingContext2D;

    const palette = RIG_PALETTES[0]!.palette;
    drawRigFrame(context, 640, 360, 'walk', 0.25, palette);

    expect(fills[0]).toBe('clear');
    expect(fills[1]).toBe(`rect:${palette.background}`);
    expect(fills).toContain(`fill:${palette.ground}`);
    expect(strokes).toHaveLength(9);
    expect(strokes.filter((color) => color === palette.accent)).toHaveLength(4);
    expect(strokes.filter((color) => color === palette.body)).toHaveLength(5);
    expect(arcs).toHaveLength(1);
    expect(Number.isFinite(arcs[0]!.x)).toBe(true);
    expect(Number.isFinite(arcs[0]!.y)).toBe(true);
  });
});
