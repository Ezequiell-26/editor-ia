/**
 * Rig 2D de stickman: esqueleto de huesos simples con poses procedurales y
 * render determinista a canvas. El clip se hornea a MP4 y entra a Medios, así
 * que el timeline/export no necesitan un segundo motor.
 *
 * No hay rigging automático desde fotos: el personaje es vectorial propio y
 * las animaciones son ciclos matemáticos acotados.
 */

export type RigClipId = 'idle' | 'walk' | 'run' | 'jump' | 'wave' | 'reach';

export interface RigClip {
  readonly id: RigClipId;
  readonly label: string;
  readonly description: string;
  /** Segundos sugeridos para un ciclo completo. */
  readonly cycleSeconds: number;
}

export const RIG_CLIPS: readonly RigClip[] = [
  { id: 'idle', label: 'Reposo', description: 'Respiración y balanceo suave.', cycleSeconds: 2.4 },
  { id: 'walk', label: 'Caminar', description: 'Ciclo de caminata con brazos opuestos.', cycleSeconds: 1.2 },
  { id: 'run', label: 'Correr', description: 'Zancada amplia, inclinación y rebote.', cycleSeconds: 0.8 },
  { id: 'jump', label: 'Saltar', description: 'Agacharse, impulso, aire y caída.', cycleSeconds: 1.6 },
  { id: 'wave', label: 'Saludar', description: 'Brazo derecho levantado y saludo.', cycleSeconds: 2.0 },
  {
    id: 'reach',
    label: 'Alcanzar (IK)',
    description: 'La mano derecha sigue un objetivo con cinemática inversa de dos huesos.',
    cycleSeconds: 2.0,
  },
];

export interface RigPose {
  /** Inclinación del torso (rad). */
  readonly lean: number;
  /** Ángulo del muslo y la rodilla; 0 apunta hacia abajo. */
  readonly thighL: number;
  readonly shinL: number;
  readonly thighR: number;
  readonly shinR: number;
  /** Ángulo del brazo y el codo; 0 apunta hacia abajo. */
  readonly armL: number;
  readonly elbowL: number;
  readonly armR: number;
  readonly elbowR: number;
  /** Desplazamiento vertical del cuerpo en píxeles normalizados (0..1). */
  readonly bob: number;
  readonly headTilt: number;
  /** Objetivo IK normalizado (0..1) para la mano derecha. */
  readonly ikTarget?: { readonly x: number; readonly y: number };
  /** Cuánto pesa el IK en la pose (0..1). */
  readonly ikAmount?: number;
}

export interface RigPalette {
  readonly background: string;
  readonly body: string;
  readonly accent: string;
  readonly ground: string;
}

export const RIG_PALETTES: readonly { id: string; label: string; palette: RigPalette }[] = [
  {
    id: 'cyan',
    label: 'Cian',
    palette: { background: '#0b1220', body: '#e2e8f0', accent: '#35d6ff', ground: '#1e293b' },
  },
  {
    id: 'amber',
    label: 'Ámbar',
    palette: { background: '#171207', body: '#f8fafc', accent: '#fbbf24', ground: '#3f2f12' },
  },
  {
    id: 'mint',
    label: 'Menta',
    palette: { background: '#07130f', body: '#e7f7ef', accent: '#4ade80', ground: '#123326' },
  },
];

export function rigClipById(id: RigClipId): RigClip {
  return RIG_CLIPS.find((clip) => clip.id === id) ?? RIG_CLIPS[0]!;
}

export function rigPaletteById(id: string): (typeof RIG_PALETTES)[number] {
  return RIG_PALETTES.find((entry) => entry.id === id) ?? RIG_PALETTES[0]!;
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Poses procedurales; todos los ángulos quedan acotados a ±1,6 rad. */
export function rigPose(
  id: RigClipId,
  progress: number,
  ikTarget?: { readonly x: number; readonly y: number },
): RigPose {
  const t = clampProgress(progress);
  const cycle = t * Math.PI * 2;
  if (id === 'reach') {
    const base = rigPose('idle', t);
    return {
      ...base,
      ikTarget: {
        x: Math.max(0, Math.min(1, ikTarget?.x ?? 0.82)),
        y: Math.max(0, Math.min(1, ikTarget?.y ?? 0.28)),
      },
      ikAmount: Math.sin(Math.PI * t),
    };
  }
  if (id === 'walk' || id === 'run') {
    const run = id === 'run';
    const swing = run ? 0.95 : 0.55;
    const lift = run ? 0.85 : 0.45;
    const step = Math.sin(cycle);
    return {
      lean: run ? 0.22 : 0.06,
      thighL: step * swing,
      shinL: Math.max(0, -step) * lift,
      thighR: -step * swing,
      shinR: Math.max(0, step) * lift,
      armL: -step * (run ? 0.8 : 0.45),
      elbowL: 0.25 + Math.abs(step) * 0.3,
      armR: step * (run ? 0.8 : 0.45),
      elbowR: 0.25 + Math.abs(step) * 0.3,
      bob: Math.abs(Math.cos(cycle)) * (run ? 0.035 : 0.018),
      headTilt: run ? -0.08 : 0,
    };
  }
  if (id === 'jump') {
    const crouch = Math.max(0, Math.sin(t * Math.PI * 2)) * (t < 0.35 ? 1 : 0);
    const air = t > 0.3 && t < 0.75 ? Math.sin(((t - 0.3) / 0.45) * Math.PI) : 0;
    return {
      lean: 0.1 - air * 0.2,
      thighL: -0.6 * crouch + air * 0.5,
      shinL: 1.1 * crouch + air * 0.9,
      thighR: -0.6 * crouch + air * 0.5,
      shinR: 1.1 * crouch + air * 0.9,
      armL: -air * 1.2,
      elbowL: 0.2 + air * 0.4,
      armR: -air * 1.2,
      elbowR: 0.2 + air * 0.4,
      bob: crouch * 0.06 + air * 0.12,
      headTilt: -air * 0.1,
    };
  }
  if (id === 'wave') {
    const wave = Math.sin(cycle * 2) * 0.35;
    return {
      lean: 0.03,
      thighL: Math.sin(cycle) * 0.08,
      shinL: 0.05,
      thighR: -Math.sin(cycle) * 0.08,
      shinR: 0.05,
      armL: 0.15,
      elbowL: 0.2,
      armR: -1.25 + wave,
      elbowR: -0.75 + wave * 0.6,
      bob: Math.abs(Math.sin(cycle)) * 0.012,
      headTilt: 0.06,
    };
  }
  return {
    lean: 0.02,
    thighL: Math.sin(cycle) * 0.05,
    shinL: 0.06,
    thighR: -Math.sin(cycle) * 0.05,
    shinR: 0.06,
    armL: 0.12 + Math.sin(cycle) * 0.06,
    elbowL: 0.18,
    armR: -0.12 - Math.sin(cycle) * 0.06,
    elbowR: 0.18,
    bob: (1 - Math.cos(cycle)) * 0.004,
    headTilt: Math.sin(cycle) * 0.03,
  };
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface RigSkeleton {
  readonly hip: Point2D;
  readonly chest: Point2D;
  readonly neck: Point2D;
  readonly head: Point2D;
  readonly shoulderL: Point2D;
  readonly elbowL: Point2D;
  readonly handL: Point2D;
  readonly shoulderR: Point2D;
  readonly elbowR: Point2D;
  readonly handR: Point2D;
  readonly kneeL: Point2D;
  readonly footL: Point2D;
  readonly kneeR: Point2D;
  readonly footR: Point2D;
}

function offset(base: Point2D, angle: number, length: number): Point2D {
  return {
    x: base.x + Math.sin(angle) * length,
    y: base.y + Math.cos(angle) * length,
  };
}

/**
 * Cinemática inversa de dos huesos en coordenadas de pantalla. El codo se
 * elige por su X (max-x para el brazo derecho) y la mano se limita al alcance.
 */
export function solveTwoBone(
  origin: Point2D,
  target: Point2D,
  upper: number,
  lower: number,
  prefer: 'max-x' | 'min-x' = 'max-x',
): { elbow: Point2D; hand: Point2D; reached: boolean } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.max(1, upper + lower);
  const minimum = Math.max(0.001, Math.abs(upper - lower) + 0.001);
  const clamped = Math.min(reach - 0.001, Math.max(minimum, distance || minimum));
  const baseAngle = Math.atan2(dy, dx);
  const cosA = (upper * upper + clamped * clamped - lower * lower) / (2 * upper * clamped);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const elbows = [baseAngle + alpha, baseAngle - alpha].map((angle) => ({
    x: origin.x + Math.cos(angle) * upper,
    y: origin.y + Math.sin(angle) * upper,
  }));
  const elbow =
    prefer === 'max-x'
      ? elbows[0]!.x >= elbows[1]!.x
        ? elbows[0]!
        : elbows[1]!
      : elbows[0]!.x <= elbows[1]!.x
        ? elbows[0]!
        : elbows[1]!;
  return {
    elbow,
    hand: {
      x: origin.x + Math.cos(baseAngle) * clamped,
      y: origin.y + Math.sin(baseAngle) * clamped,
    },
    reached: distance <= reach,
  };
}

/** Posiciones en píxeles para un canvas de `width`×`height`. */
export function rigSkeleton(
  pose: RigPose,
  width: number,
  height: number,
): RigSkeleton {
  const safeWidth = Math.max(32, finite(width, 480));
  const safeHeight = Math.max(32, finite(height, 270));
  const ground = safeHeight * 0.86;
  const hip = {
    x: safeWidth * 0.5 + Math.sin(pose.lean) * safeHeight * 0.02,
    y: ground - safeHeight * 0.3 - pose.bob * safeHeight,
  };
  const torsoLength = safeHeight * 0.2;
  const chest = offset(hip, Math.PI + pose.lean, torsoLength * 0.68);
  const neck = offset(chest, Math.PI + pose.lean, torsoLength * 0.32);
  const head = offset(neck, Math.PI + pose.lean + pose.headTilt, safeHeight * 0.09);
  const shoulderL = offset(neck, Math.PI + 0.35 + pose.lean, safeHeight * 0.02);
  const shoulderR = offset(neck, Math.PI - 0.35 + pose.lean, safeHeight * 0.02);
  const upperArm = safeHeight * 0.16;
  const forearm = safeHeight * 0.15;
  const elbowL = offset(shoulderL, pose.armL, upperArm);
  const handL = offset(elbowL, pose.armL + pose.elbowL, forearm);
  let elbowR = offset(shoulderR, pose.armR, upperArm);
  let handR = offset(elbowR, pose.armR + pose.elbowR, forearm);
  const ikAmount = Math.max(0, Math.min(1, pose.ikAmount ?? 0));
  if (pose.ikTarget && ikAmount > 0) {
    const target = {
      x: pose.ikTarget.x * safeWidth,
      y: pose.ikTarget.y * safeHeight,
    };
    const blended = {
      x: handR.x + (target.x - handR.x) * ikAmount,
      y: handR.y + (target.y - handR.y) * ikAmount,
    };
    const solved = solveTwoBone(shoulderR, blended, upperArm, forearm, 'max-x');
    elbowR = solved.elbow;
    handR = solved.hand;
  }
  const thigh = safeHeight * 0.19;
  const shin = safeHeight * 0.17;
  const kneeL = offset(hip, pose.thighL, thigh);
  const footL = offset(kneeL, pose.thighL + pose.shinL, shin);
  const kneeR = offset(hip, pose.thighR, thigh);
  const footR = offset(kneeR, pose.thighR + pose.shinR, shin);
  return {
    hip,
    chest,
    neck,
    head,
    shoulderL,
    elbowL,
    handL,
    shoulderR,
    elbowR,
    handR,
    kneeL,
    footL,
    kneeR,
    footR,
  };
}

/** Dibuja un frame del rig; `progress` va de 0 a 1. */
export interface RigDrawOptions {
  readonly target?: { readonly x: number; readonly y: number };
}

export function drawRigFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: RigClipId,
  progress: number,
  palette: RigPalette,
  options: RigDrawOptions = {},
): void {
  const pose = rigPose(clip, progress, options.target);
  const joints = rigSkeleton(pose, width, height);
  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = palette.ground;
  context.beginPath();
  context.ellipse(width * 0.5, height * 0.86, width * 0.22, height * 0.035, 0, 0, Math.PI * 2);
  context.fill();

  const line = (
    from: Point2D,
    to: Point2D,
    color: string,
    thickness: number,
  ): void => {
    context.strokeStyle = color;
    context.lineWidth = thickness;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  };

  const back = palette.body;
  const front = palette.accent;
  const thickness = Math.max(3, height * 0.022);
  // Brazo y pierna del lado lejano primero.
  line(joints.shoulderR, joints.elbowR, back, thickness);
  line(joints.elbowR, joints.handR, back, thickness);
  line(joints.hip, joints.kneeR, back, thickness);
  line(joints.kneeR, joints.footR, back, thickness);
  // Torso.
  line(joints.hip, joints.neck, palette.body, thickness * 1.35);
  // Extremidades cercanas.
  line(joints.hip, joints.kneeL, front, thickness);
  line(joints.kneeL, joints.footL, front, thickness);
  line(joints.shoulderL, joints.elbowL, front, thickness);
  line(joints.elbowL, joints.handL, front, thickness);
  // Cabeza.
  context.fillStyle = palette.accent;
  context.beginPath();
  context.arc(joints.head.x, joints.head.y, height * 0.055, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
