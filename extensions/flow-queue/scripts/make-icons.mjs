/**
 * Generates the extension icons without external image dependencies.
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
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
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
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

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function fillRect(rgba, size, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y <= Math.min(size - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x += 1) {
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
}

function triangle(rgba, size, x0, y0, height, color) {
  for (let row = 0; row < height; row += 1) {
    const half = Math.round((row * 0.55));
    fillRect(rgba, size, x0, y0 + row, x0 + half, y0 + row, color);
  }
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const radius = Math.max(2, Math.round(size * 0.24));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedRect(x, y, 0, 0, size - 1, size - 1, radius)) continue;
      const offset = (y * size + x) * 4;
      const t = y / Math.max(1, size - 1);
      rgba[offset] = Math.round(28 + 25 * t);
      rgba[offset + 1] = Math.round(92 + 80 * t);
      rgba[offset + 2] = Math.round(214 + 30 * t);
      rgba[offset + 3] = 255;
    }
  }

  const white = [255, 255, 255, 255];
  const lineHeight = Math.max(1, Math.round(size * 0.075));
  const left = Math.round(size * 0.22);
  const right = Math.round(size * 0.72);
  const tops = [0.26, 0.46, 0.66].map((value) => Math.round(size * value));
  for (const [index, top] of tops.entries()) {
    const width = index === 2 ? Math.round(size * 0.3) : right;
    fillRect(rgba, size, left, top, width, top + lineHeight - 1, white);
  }

  if (size >= 32) {
    const playX = Math.round(size * 0.76);
    const playY = Math.round(size * 0.55);
    const playH = Math.round(size * 0.3);
    triangle(rgba, size, playX, playY, playH, white);
  }

  return encodePng(size, size, rgba);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), drawIcon(size));
  console.log(`icons/icon${size}.png`);
}
