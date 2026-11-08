import { describe, expect, it } from 'vitest';
import {
  poseAtKeyframes,
  rigForHeight,
  solveSkeleton,
  STAND_POSE,
  STICKMAN_BONES,
  STICKMAN_SEGMENTS,
  type StickmanKeyframe,
  type StickmanPose,
} from './stickman-rig';

describe('stickman-rig', () => {
  it('de pie: los muslos apuntan hacia abajo y el pie queda bajo la rodilla', () => {
    const sk = solveSkeleton(STAND_POSE, 640, 360);
    const j = sk.joints;
    // Mismo assert que `stand_pose_has_vertical_limbs` en Rust.
    expect(j.knee_l.y - j.hip_l.y).toBeGreaterThan(40);
    expect(j.foot_l.y).toBeGreaterThan(j.knee_l.y);
    expect(j.knee_r.y - j.hip_r.y).toBeGreaterThan(40);
    // Piernas rectas: rodilla y pie caen en la misma X que la cadera.
    expect(j.knee_l.x).toBeCloseTo(j.hip_l.x, 6);
    expect(j.foot_l.x).toBeCloseTo(j.knee_l.x, 6);
    expect(j.knee_r.x).toBeCloseTo(j.hip_r.x, 6);
  });

  it('el rig escala con la altura como en Rust (u = h/360)', () => {
    const rig360 = rigForHeight(360);
    const rig720 = rigForHeight(720);
    expect(rig720.spine_len).toBeCloseTo(rig360.spine_len * 2, 6);
    expect(rig720.thigh).toBeCloseTo(rig360.thigh * 2, 6);
  });

  it('pelvis_dy desplaza toda la cadena hacia arriba', () => {
    const base = solveSkeleton(STAND_POSE, 640, 360);
    const jumped = solveSkeleton({ ...STAND_POSE, pelvis_dy: -40 }, 640, 360);
    expect(jumped.joints.pelvis.y).toBeCloseTo(base.joints.pelvis.y - 40, 6);
    expect(jumped.joints.head.y).toBeCloseTo(base.joints.head.y - 40, 6);
    expect(jumped.joints.foot_l.y).toBeCloseTo(base.joints.foot_l.y - 40, 6);
  });

  it('poseAtKeyframes interpola lineal y clampea en los extremos', () => {
    const upper = Math.PI / 2;
    const kfs: StickmanKeyframe[] = [
      { frame: 0, ...STAND_POSE },
      { frame: 24, ...STAND_POSE, upper_arm_r: -1.5 },
    ];
    const mid = poseAtKeyframes(kfs, 12);
    expect(mid.upper_arm_r).toBeCloseTo((upper + -1.5) / 2, 6);
    const end = poseAtKeyframes(kfs, 24);
    expect(end.upper_arm_r).toBeCloseTo(-1.5, 6);
    const over = poseAtKeyframes(kfs, 100);
    expect(over.upper_arm_r).toBeCloseTo(-1.5, 6);
    const before = poseAtKeyframes(kfs, -5);
    expect(before.upper_arm_r).toBeCloseTo(upper, 6);
  });

  it('poseAtKeyframes ordena keyframes desordenados y maneja listas vacías', () => {
    const kfs: StickmanKeyframe[] = [
      { frame: 24, ...STAND_POSE, spine: 0 },
      { frame: 0, ...STAND_POSE },
    ];
    expect(poseAtKeyframes(kfs, 12).spine).toBeCloseTo(Math.PI / 4, 6);
    expect(poseAtKeyframes([], 10)).toEqual(STAND_POSE);
  });

  it('todos los huesos están en rango angular razonable para el slider', () => {
    // Sanity: el ángulo del muslo "down" es π/2 y los sliders usan radianes.
    expect(STAND_POSE.thigh_l).toBeCloseTo(Math.PI / 2, 6);
    expect(STICKMAN_BONES).toHaveLength(11);
    expect(STICKMAN_SEGMENTS).toHaveLength(14);
  });
});
