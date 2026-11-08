/**
 * Rig del stickman en TypeScript — puerto fiel de la geometría FK de
 * `apps/desktop/src-tauri/src/commands/stickman.rs` para que el preview del
 * editor visual coincida con el MP4 que renderiza el motor Rust.
 *
 * Los nombres de campo son snake_case porque así los espera el serde de
 * `Pose`/`PoseKeyframe` (sin `rename_all`: `upper_arm_l`, `pelvis_dy`, ...).
 *
 * Convención de ángulos (igual que Rust): `0` apunta a la derecha, el eje Y
 * crece hacia abajo (coordenadas de pantalla) y `π/2` apunta hacia abajo.
 */

export interface StickmanPose {
  readonly spine: number;
  readonly head: number;
  readonly upper_arm_l: number;
  readonly fore_arm_l: number;
  readonly upper_arm_r: number;
  readonly fore_arm_r: number;
  readonly thigh_l: number;
  readonly shin_l: number;
  readonly thigh_r: number;
  readonly shin_r: number;
  readonly pelvis_dy: number;
}

export interface StickmanKeyframe extends StickmanPose {
  readonly frame: number;
}

const DOWN = Math.PI / 2;

/** Pose de "de pie": misma que `stand_pose()` del motor Rust. */
export const STAND_POSE: StickmanPose = {
  spine: DOWN,
  head: DOWN,
  upper_arm_l: DOWN,
  fore_arm_l: DOWN,
  upper_arm_r: DOWN,
  fore_arm_r: DOWN,
  thigh_l: DOWN,
  shin_l: DOWN,
  thigh_r: DOWN,
  shin_r: DOWN,
  pelvis_dy: 0,
};

/** Campos editables del pose, en el orden en que se muestran en la UI. */
export const STICKMAN_BONES = [
  { key: 'spine', label: 'Columna' },
  { key: 'head', label: 'Cabeza' },
  { key: 'upper_arm_l', label: 'Brazo sup. izq.' },
  { key: 'fore_arm_l', label: 'Antebrazo izq.' },
  { key: 'upper_arm_r', label: 'Brazo sup. der.' },
  { key: 'fore_arm_r', label: 'Antebrazo der.' },
  { key: 'thigh_l', label: 'Muslo izq.' },
  { key: 'shin_l', label: 'Espinilla izq.' },
  { key: 'thigh_r', label: 'Muslo der.' },
  { key: 'shin_r', label: 'Espinilla der.' },
  { key: 'pelvis_dy', label: 'Cadera (px)' },
] as const;

export type StickmanBoneKey = (typeof STICKMAN_BONES)[number]['key'];

export function lerpPose(a: StickmanPose, b: StickmanPose, t: number): StickmanPose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    spine: mix(a.spine, b.spine),
    head: mix(a.head, b.head),
    upper_arm_l: mix(a.upper_arm_l, b.upper_arm_l),
    fore_arm_l: mix(a.fore_arm_l, b.fore_arm_l),
    upper_arm_r: mix(a.upper_arm_r, b.upper_arm_r),
    fore_arm_r: mix(a.fore_arm_r, b.fore_arm_r),
    thigh_l: mix(a.thigh_l, b.thigh_l),
    shin_l: mix(a.shin_l, b.shin_l),
    thigh_r: mix(a.thigh_r, b.thigh_r),
    shin_r: mix(a.shin_r, b.shin_r),
    pelvis_dy: mix(a.pelvis_dy, b.pelvis_dy),
  };
}

function poseFields(pose: StickmanPose): StickmanPose {
  return { ...pose };
}

/** Pose de un keyframe sin el campo `frame` (para cargarlo en el borrador). */
export function keyframePose(kf: StickmanKeyframe): StickmanPose {
  return poseFields(kf);
}

/**
 * Interpolación lineal por hueso entre keyframes ordenados por `frame`.
 * Fuera de rango devuelve el extremo — igual que `pose_from_keyframes`.
 */
export function poseAtKeyframes(
  keyframes: readonly StickmanKeyframe[],
  frame: number,
): StickmanPose {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return STAND_POSE;
  if (sorted.length === 1 || frame <= first.frame) return keyframePose(first);
  if (frame >= last.frame) return keyframePose(last);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a || !b) continue;
    if (frame >= a.frame && frame <= b.frame) {
      const span = b.frame - a.frame;
      const t = span === 0 ? 0 : (frame - a.frame) / span;
      return lerpPose(keyframePose(a), keyframePose(b), t);
    }
  }
  return keyframePose(last);
}

// ---------------------------------------------------------------------------
// Geometría FK — espejo de `Rig::for_height` + `solve_skeleton` en Rust.
// ---------------------------------------------------------------------------

export interface RigDims {
  readonly spine_len: number;
  readonly neck_len: number;
  readonly head_r: number;
  readonly upper_arm: number;
  readonly fore_arm: number;
  readonly thigh: number;
  readonly shin: number;
  readonly hip_half: number;
  readonly shoulder_half: number;
}

export function rigForHeight(height: number): RigDims {
  const u = height / 360;
  return {
    spine_len: 62 * u,
    neck_len: 14 * u,
    head_r: 16 * u,
    upper_arm: 40 * u,
    fore_arm: 38 * u,
    thigh: 66 * u,
    shin: 62 * u,
    hip_half: 9 * u,
    shoulder_half: 20 * u,
  };
}

export interface V2 {
  readonly x: number;
  readonly y: number;
}

export type JointName =
  | 'pelvis'
  | 'chest'
  | 'head'
  | 'shoulder_l'
  | 'elbow_l'
  | 'hand_l'
  | 'shoulder_r'
  | 'elbow_r'
  | 'hand_r'
  | 'hip_l'
  | 'knee_l'
  | 'foot_l'
  | 'hip_r'
  | 'knee_r'
  | 'foot_r';

export interface Skeleton {
  readonly joints: Readonly<Record<JointName, V2>>;
  readonly rig: RigDims;
}

function fromAngle(len: number, angle: number): V2 {
  return { x: len * Math.cos(angle), y: len * Math.sin(angle) };
}

/** Resuelve las posiciones de las 15 articulaciones para un pose y tamaño. */
export function solveSkeleton(pose: StickmanPose, width: number, height: number): Skeleton {
  const rig = rigForHeight(height);
  const groundY = height * 0.88;
  const legReach = rig.thigh + rig.shin;
  const pelvis: V2 = {
    x: width * 0.5,
    y: groundY - legReach * 0.92 + pose.pelvis_dy,
  };
  const chest: V2 = {
    x: pelvis.x + fromAngle(rig.spine_len, pose.spine).x,
    y: pelvis.y + fromAngle(rig.spine_len, pose.spine).y,
  };
  const headOffset = fromAngle(rig.neck_len + rig.head_r, pose.head);
  const head: V2 = { x: chest.x + headOffset.x, y: chest.y + headOffset.y };

  const joints = {} as Record<JointName, V2>;
  joints.pelvis = pelvis;
  joints.chest = chest;
  joints.head = head;

  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? -1 : 1;
    const shoulder: V2 = { x: chest.x + sign * rig.shoulder_half, y: chest.y };
    const upperArm = side === 'l' ? pose.upper_arm_l : pose.upper_arm_r;
    const foreArm = side === 'l' ? pose.fore_arm_l : pose.fore_arm_r;
    const thigh = side === 'l' ? pose.thigh_l : pose.thigh_r;
    const shin = side === 'l' ? pose.shin_l : pose.shin_r;
    const elbowOffset = fromAngle(rig.upper_arm, upperArm);
    const elbow: V2 = { x: shoulder.x + elbowOffset.x, y: shoulder.y + elbowOffset.y };
    const handOffset = fromAngle(rig.fore_arm, foreArm);
    const hand: V2 = { x: elbow.x + handOffset.x, y: elbow.y + handOffset.y };
    const hip: V2 = { x: pelvis.x + sign * rig.hip_half, y: pelvis.y };
    const kneeOffset = fromAngle(rig.thigh, thigh);
    const knee: V2 = { x: hip.x + kneeOffset.x, y: hip.y + kneeOffset.y };
    const footOffset = fromAngle(rig.shin, shin);
    const foot: V2 = { x: knee.x + footOffset.x, y: knee.y + footOffset.y };
    joints[`shoulder_${side}`] = shoulder;
    joints[`elbow_${side}`] = elbow;
    joints[`hand_${side}`] = hand;
    joints[`hip_${side}`] = hip;
    joints[`knee_${side}`] = knee;
    joints[`foot_${side}`] = foot;
  }
  return { joints, rig };
}

/** Segmentos que dibuja `render_frame` en Rust, en el mismo orden. */
export const STICKMAN_SEGMENTS: readonly (readonly [JointName, JointName])[] = [
  ['pelvis', 'chest'],
  ['chest', 'head'],
  ['chest', 'shoulder_l'],
  ['shoulder_l', 'elbow_l'],
  ['elbow_l', 'hand_l'],
  ['chest', 'shoulder_r'],
  ['shoulder_r', 'elbow_r'],
  ['elbow_r', 'hand_r'],
  ['pelvis', 'hip_l'],
  ['hip_l', 'knee_l'],
  ['knee_l', 'foot_l'],
  ['pelvis', 'hip_r'],
  ['hip_r', 'knee_r'],
  ['knee_r', 'foot_r'],
] as const;
