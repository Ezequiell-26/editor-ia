import type { PerspectiveCorner } from '@editor-ia/project-schema';

/**
 * Geometría de la preview para la perspectiva: tamaño del cuadro en pantalla y
 * del medio de origen. Con `mediaWidth`/`mediaHeight` se replica el
 * `object-fit: contain` para que la deformación coincida con el encuadre real.
 */
export interface PerspectiveViewport {
  readonly width: number;
  readonly height: number;
  readonly mediaWidth?: number;
  readonly mediaHeight?: number;
}

export interface ContentBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Point = readonly [number, number];
type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const DEFAULT_CORNERS: readonly Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Cuadro completo del medio dentro del elemento, como `object-fit: contain`. */
export function fittedContentBox(viewport: PerspectiveViewport): ContentBox {
  const { width, height, mediaWidth, mediaHeight } = viewport;
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) };
  }
  if (!mediaWidth || !mediaHeight || mediaWidth <= 0 || mediaHeight <= 0) {
    return { x: 0, y: 0, width, height };
  }
  const mediaAspect = mediaWidth / mediaHeight;
  const canvasAspect = width / height;
  if (mediaAspect > canvasAspect) {
    const contentHeight = width / mediaAspect;
    return { x: 0, y: (height - contentHeight) / 2, width, height: contentHeight };
  }
  const contentWidth = height * mediaAspect;
  return { x: (width - contentWidth) / 2, y: 0, width: contentWidth, height };
}

function solve(rows: number[][]): number[] | null {
  const size = rows.length;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let index = column; index <= size; index += 1) {
      rows[column]![index] = rows[column]![index]! / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      if (Math.abs(factor) < 1e-15) continue;
      for (let index = column; index <= size; index += 1) {
        rows[row]![index] = rows[row]![index]! - factor * rows[column]![index]!;
      }
    }
  }
  return rows.map((row) => row[size]!);
}

/** Homografía que lleva `source[i]` a `destination[i]` (h33 = 1). */
export function homography(
  source: readonly Point[],
  destination: readonly Point[],
): Matrix3 | null {
  if (source.length !== 4 || destination.length !== 4) return null;
  const rows: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = source[index]!;
    const [u, v] = destination[index]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const solution = solve(rows);
  if (!solution) return null;
  return [
    solution[0]!,
    solution[1]!,
    solution[2]!,
    solution[3]!,
    solution[4]!,
    solution[5]!,
    solution[6]!,
    solution[7]!,
    1,
  ];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const result = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let index = 0; index < 3; index += 1) {
        sum += a[row * 3 + index]! * b[index * 3 + column]!;
      }
      result[row * 3 + column] = sum;
    }
  }
  return result as unknown as Matrix3;
}

function translation(x: number, y: number): Matrix3 {
  return [1, 0, x, 0, 1, y, 0, 0, 1];
}

function scaling(x: number, y: number): Matrix3 {
  return [x, 0, 0, 0, y, 0, 0, 0, 1];
}

function almost(value: number, target: number): boolean {
  return Math.abs(value - target) < 0.0005;
}

function isDefault(corners: readonly PerspectiveCorner[]): boolean {
  return corners.every(
    (corner, index) =>
      almost(corner.x, DEFAULT_CORNERS[index]![0]) &&
      almost(corner.y, DEFAULT_CORNERS[index]![1]),
  );
}

/** Punto transformado en píxeles del elemento, útil para tests y depuración. */
export function applyMatrix3(point: Point, matrix: Matrix3): Point {
  const [x, y] = point;
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(w) < 1e-12) return [Number.NaN, Number.NaN];
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / w,
  ];
}

/**
 * `matrix3d` que replica en CSS el filtro `perspective` del export:
 * el cuadrilátero de origen (TL, TR, BR, BL) llena el cuadro del medio.
 *
 * El MP4 define las esquinas en píxeles del perfil y las aplica al frame ya
 * escalado, así que con un medio de otra proporción el cuadrilátero se estira
 * con el encuadre; por eso el origen usa `corner * viewport` sobre la caja del
 * contenido. El resultado queda expresado para `transform-origin: center` y se
 * encadena antes de translate/scale/rotate (igual orden que el render).
 */
export function perspectiveMatrix3d(
  corners: readonly PerspectiveCorner[],
  viewport: PerspectiveViewport,
): string | undefined {
  if (corners.length !== 4) return undefined;
  if (viewport.width <= 0 || viewport.height <= 0) return undefined;
  if (isDefault(corners)) return undefined;
  const box = fittedContentBox(viewport);
  if (box.width < 1 || box.height < 1) return undefined;
  // Se resuelve en coordenadas normalizadas del frame (0..1) para no perder
  // precisión con píxeles grandes; después se reescala a píxeles del elemento.
  const source: Point[] = corners.map((corner) => [
    (corner.x * viewport.width) / box.width,
    (corner.y * viewport.height) / box.height,
  ]);
  const destination: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const plane = homography(source, destination);
  if (!plane) return undefined;
  const toPixels = multiply(
    multiply(translation(box.x, box.y), scaling(box.width, box.height)),
    multiply(plane, multiply(scaling(1 / box.width, 1 / box.height), translation(-box.x, -box.y))),
  );
  const originX = viewport.width / 2;
  const originY = viewport.height / 2;
  // CSS aplica el origen alrededor de toda la lista: T(-O) · H · T(O).
  const css = multiply(
    multiply(translation(-originX, -originY), toPixels),
    translation(originX, originY),
  );
  const w = css[8]!;
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return undefined;
  const normalized = css.map((value) => value / w);
  const format = (value: number): string =>
    Number.isFinite(value) ? String(Number(value.toFixed(8))) : '0';
  // matrix3d es column-major y los términos 14/24 hacen la división proyectiva.
  const values = [
    normalized[0], normalized[3], 0, normalized[6],
    normalized[1], normalized[4], 0, normalized[7],
    0, 0, 1, 0,
    normalized[2], normalized[5], 0, normalized[8],
  ].map((value) => format(value!));
  return `matrix3d(${values.join(',')})`;
}
