/**
 * Generates assets/icon.png and assets/icon.ico without any image dependencies.
 * The mark is a dark rounded square with a champagne-gold play triangle.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const OUT = path.join(__dirname, '..', 'assets');

// ------------------------------------------------------------------ drawing

function render(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size / 2;

  // Play triangle geometry, optically centred.
  const triH = size * 0.40;
  const triW = size * 0.34;
  const tx = cx - triW * 0.36;
  const ty = cy;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const inSquare = roundedRectCoverage(x + 0.5, y + 0.5, size, r);
      if (inSquare <= 0) continue;

      // Background: subtle vertical gradient from #12151C to #07080B
      const t = y / size;
      let cr = lerp(0x14, 0x07, t);
      let cg = lerp(0x17, 0x08, t);
      let cb = lerp(0x1F, 0x0B, t);

      // Gold triangle
      const tri = triangleCoverage(x + 0.5, y + 0.5, tx, ty, triW, triH);
      if (tri > 0) {
        // gold gradient top-left bright -> bottom-right deep
        const g = clamp((x / size) * 0.6 + (y / size) * 0.6, 0, 1);
        const gr = lerp(0xF7, 0xB0, g);
        const gg = lerp(0xE7, 0x8D, g);
        const gb = lerp(0xBE, 0x3F, g);
        cr = lerp(cr, gr, tri);
        cg = lerp(cg, gg, tri);
        cb = lerp(cb, gb, tri);
      }

      px[i] = Math.round(cr);
      px[i + 1] = Math.round(cg);
      px[i + 2] = Math.round(cb);
      px[i + 3] = Math.round(255 * inSquare);
    }
  }
  return px;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Anti-aliased coverage of a rounded square filling the canvas with a 6% inset. */
function roundedRectCoverage(x, y, size, r) {
  const inset = size * 0.055;
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;

  const dx = Math.max(left + r - x, 0, x - (right - r));
  const dy = Math.max(top + r - y, 0, y - (bottom - r));
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (x < left - 1 || x > right + 1 || y < top - 1 || y > bottom + 1) return 0;
  return clamp(r - dist + 0.5, 0, 1);
}

/** Anti-aliased coverage of an isoceles triangle pointing right. */
function triangleCoverage(x, y, tx, ty, w, hgt) {
  const localX = x - tx;
  const localY = y - ty;
  if (localX < 0 || localX > w) return 0;
  const halfAt = (hgt / 2) * (1 - localX / w);
  const d = halfAt - Math.abs(localY);
  const edge = clamp(d + 0.5, 0, 1);
  const leftEdge = clamp(localX + 0.5, 0, 1);
  const rightEdge = clamp(w - localX + 0.5, 0, 1);
  return edge * leftEdge * rightEdge;
}

// -------------------------------------------------------------- PNG writing

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // one filter byte (0 = none) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** ICO container holding PNG-compressed entries (Vista+ supports this). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    dir[at] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 2] = 0; // palette
    dir[at + 3] = 0;
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32BE(0, at + 8);
    dir.writeUInt32LE(entry.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --------------------------------------------------------------------- main

fs.mkdirSync(OUT, { recursive: true });

const mainPng = encodePng(render(SIZE), SIZE);
fs.writeFileSync(path.join(OUT, 'icon.png'), mainPng);
console.log(`[icon] icon.png  ${SIZE}x${SIZE}  (${(mainPng.length / 1024).toFixed(1)} KB)`);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const entries = icoSizes.map((size) => ({ size, png: encodePng(render(size), size) }));
const ico = encodeIco(entries);
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
console.log(`[icon] icon.ico  ${icoSizes.join(', ')}  (${(ico.length / 1024).toFixed(1)} KB)`);
