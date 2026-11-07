import type { ColorWheelValue, WheelXY } from '@editor-ia/project-schema';

/**
 * Single source of truth for the wheel coordinate system.
 *
 * The Filmora properties panel works in X/Y (what the reference screenshots
 * show), while the project schema stores RGB triplets for the four primaries.
 * Both representations are the same plane: u = blue - luma and v = red - luma,
 * with `1.2` being the full wheel throw used by the existing `GradeWheel`.
 * Keeping the conversion here avoids two independent implementations.
 */

export const WHEEL_THROW = 1.2;

export function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** X/Y (+ optional luminance) -> RGB wheel value understood by the compiler. */
export function wheelValueFromXY(x: number, y: number, luma = 0): ColorWheelValue {
  const u = clampSigned(x) * WHEEL_THROW;
  const v = clampSigned(y) * WHEEL_THROW;
  return {
    r: round3(clampSigned(luma + v)),
    g: round3(clampSigned(luma - u - v)),
    b: round3(clampSigned(luma + u)),
  };
}

/** RGB wheel value -> X/Y coordinates for the numeric fields and the dot. */
export function xyFromWheelValue(value: ColorWheelValue): { x: number; y: number; luma: number } {
  const luma = (value.r + value.g + value.b) / 3;
  return {
    x: round3(clampSigned((value.b - luma) / WHEEL_THROW)),
    y: round3(clampSigned((value.r - luma) / WHEEL_THROW)),
    luma: round3(clampSigned(luma)),
  };
}

export function neutralXY(): WheelXY {
  return { x: 0, y: 0, luma: 0 };
}
