import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
const SUPERSAMPLE = 4;
const DESIGN = 512;

const background = [11, 17, 23, 255];
const border = [38, 52, 66, 255];
const accent = [94, 234, 212, 255];

function insideRounded(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nearestX = Math.max(left + radius, Math.min(right - radius, x));
  const nearestY = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function triangle(x, y, ax, ay, bx, by, cx, cy) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function render(size) {
  const big = size * SUPERSAMPLE;
  const scale = big / DESIGN;
  const pixels = new Uint8Array(big * big * 4);
  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const dx = x / scale;
      const dy = y / scale;
      const index = (y * big + x) * 4;
      if (!insideRounded(dx, dy, 24, 24, 488, 488, 112)) continue;
      let color = background;
      if (!insideRounded(dx, dy, 28, 28, 484, 484, 108)) color = border;
      if (
        (dx >= 232 && dx <= 280 && dy >= 128 && dy <= 310) ||
        triangle(dx, dy, 156, 292, 356, 292, 256, 424)
      ) {
        color = accent;
      }
      if (insideRounded(dx, dy, 250, 160, 262, 236, 6)) color = background;
      pixels.set(color, index);
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const sourceX = x * SUPERSAMPLE + sx;
          const sourceY = y * SUPERSAMPLE + sy;
          const index = (sourceY * big + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] += pixels[index + channel];
          }
        }
      }
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        out[index + channel] = Math.round(sums[channel] / (SUPERSAMPLE * SUPERSAMPLE));
      }
    }
  }
  return out;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const rgba = render(size);
  writeFileSync(join(outDir, `icon${size}.png`), png(size, rgba));
  console.log(`icons/icon${size}.png`);
}
