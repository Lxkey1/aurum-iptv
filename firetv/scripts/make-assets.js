/**
 * Generates the Fire TV launcher banner (320x180) and the launcher icons at
 * every density, with no image dependencies. Run: node scripts/make-assets.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RES = path.join(__dirname, '..', 'app', 'src', 'main', 'res');

// ----------------------------------------------------------------- canvas

function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  return {
    w,
    h,
    px,
    blend(x, y, r, g, b, a) {
      if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      const dstA = px[i + 3] / 255;
      const outA = a + dstA * (1 - a);
      if (outA <= 0) return;
      px[i] = Math.round((r * a + px[i] * dstA * (1 - a)) / outA);
      px[i + 1] = Math.round((g * a + px[i + 1] * dstA * (1 - a)) / outA);
      px[i + 2] = Math.round((b * a + px[i + 2] * dstA * (1 - a)) / outA);
      px[i + 3] = Math.round(outA * 255);
    }
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Signed-distance line segment, anti-aliased. */
function strokeLine(c, x1, y1, x2, y2, width, colour) {
  const half = width / 2;
  const minX = Math.floor(Math.min(x1, x2) - half - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + half + 1);
  const minY = Math.floor(Math.min(y1, y2) - half - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + half + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = distToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2);
      const a = clamp(half - d + 0.5, 0, 1);
      if (a > 0) {
        const [r, g, b] = colour(x, y);
        c.blend(x, y, r, g, b, a);
      }
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function fillRoundedRect(c, x0, y0, x1, y1, radius, colour) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      const dx = Math.max(x0 + radius - (x + 0.5), 0, x + 0.5 - (x1 - radius));
      const dy = Math.max(y0 + radius - (y + 0.5), 0, y + 0.5 - (y1 - radius));
      const a = clamp(radius - Math.hypot(dx, dy) + 0.5, 0, 1);
      if (a > 0) {
        const [r, g, b] = colour(x, y);
        c.blend(x, y, r, g, b, a);
      }
    }
  }
}

function fillTriangle(c, ox, oy, w, hgt, colour) {
  for (let y = Math.floor(oy - hgt / 2) - 1; y <= Math.ceil(oy + hgt / 2) + 1; y += 1) {
    for (let x = Math.floor(ox) - 1; x <= Math.ceil(ox + w) + 1; x += 1) {
      const lx = x + 0.5 - ox;
      const ly = y + 0.5 - oy;
      if (lx < 0 || lx > w) continue;
      const halfAt = (hgt / 2) * (1 - lx / w);
      const a = clamp(halfAt - Math.abs(ly) + 0.5, 0, 1) *
        clamp(lx + 0.5, 0, 1) * clamp(w - lx + 0.5, 0, 1);
      if (a > 0) {
        const [r, g, b] = colour(x, y);
        c.blend(x, y, r, g, b, a);
      }
    }
  }
}

// -------------------------------------------------------------- stroke font

/** Segments are in a 0..1 box; y runs top(0) to bottom(1). */
const GLYPHS = {
  A: [[0, 1, 0.5, 0], [0.5, 0, 1, 1], [0.17, 0.66, 0.83, 0.66]],
  U: [[0, 0, 0, 0.72], [0, 0.72, 0.18, 1], [0.18, 1, 0.82, 1], [0.82, 1, 1, 0.72], [1, 0.72, 1, 0]],
  R: [[0, 1, 0, 0], [0, 0, 0.72, 0], [0.72, 0, 1, 0.22], [1, 0.22, 0.72, 0.5], [0.72, 0.5, 0, 0.5], [0.45, 0.5, 1, 1]],
  M: [[0, 1, 0, 0], [0, 0, 0.5, 0.62], [0.5, 0.62, 1, 0], [1, 0, 1, 1]],
  T: [[0, 0, 1, 0], [0.5, 0, 0.5, 1]],
  V: [[0, 0, 0.5, 1], [0.5, 1, 1, 0]]
};

function drawText(c, text, x, y, size, tracking, weight, colour) {
  let cursor = x;
  const glyphW = size * 0.68;
  for (const ch of text) {
    if (ch === ' ') {
      cursor += glyphW * 0.55 + tracking;
      continue;
    }
    const segs = GLYPHS[ch];
    if (segs) {
      for (const [x1, y1, x2, y2] of segs) {
        strokeLine(c, cursor + x1 * glyphW, y + y1 * size, cursor + x2 * glyphW, y + y2 * size, weight, colour);
      }
    }
    cursor += glyphW + tracking;
  }
  return cursor - x - tracking;
}

function textWidth(text, size, tracking) {
  const glyphW = size * 0.68;
  let w = 0;
  for (const ch of text) w += (ch === ' ' ? glyphW * 0.55 : glyphW) + tracking;
  return w - tracking;
}

// -------------------------------------------------------------- PNG writer

function crc32(buf) {
  const table = crc32.t || (crc32.t = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
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
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(c.h * (c.w * 4 + 1));
  for (let y = 0; y < c.h; y += 1) {
    raw[y * (c.w * 4 + 1)] = 0;
    c.px.copy(raw, y * (c.w * 4 + 1) + 1, y * c.w * 4, (y + 1) * c.w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ------------------------------------------------------------------ pieces

const gold = (w) => (x, y) => {
  const t = clamp((x / w) * 0.55 + 0.15, 0, 1);
  return [lerp(0xf7, 0xb0, t), lerp(0xe7, 0x8d, t), lerp(0xbe, 0x3f, t)];
};

function paintBackdrop(c) {
  for (let y = 0; y < c.h; y += 1) {
    for (let x = 0; x < c.w; x += 1) {
      const t = y / c.h;
      // vignette warmth in the top-left where the mark sits
      const glow = Math.max(0, 1 - Math.hypot(x / c.w - 0.18, y / c.h - 0.45) * 1.9);
      const r = lerp(0x11, 0x06, t) + glow * 22;
      const g = lerp(0x14, 0x07, t) + glow * 18;
      const b = lerp(0x1c, 0x0a, t) + glow * 8;
      c.blend(x, y, Math.round(r), Math.round(g), Math.round(b), 1);
    }
  }
}

function makeBanner() {
  const W = 320;
  const H = 180;
  const c = canvas(W, H);
  paintBackdrop(c);

  // Rounded gold badge with a play triangle
  const bx = 26;
  const by = H / 2 - 27;
  fillRoundedRect(c, bx, by, bx + 54, by + 54, 16, gold(W));
  fillTriangle(c, bx + 20, by + 27, 22, 24, () => [0x0a, 0x0b, 0x0e]);

  // Wordmark
  const size = 26;
  const tracking = 5;
  drawText(c, 'AURUM', bx + 72, H / 2 - 26, size, tracking, 2.6, () => [0xf4, 0xf5, 0xf8]);
  const tvSize = 13;
  drawText(c, 'TV', bx + 74, H / 2 + 12, tvSize, 7, 1.7, gold(W));

  // hairline under the wordmark
  strokeLine(c, bx + 74, H / 2 + 6, bx + 74 + textWidth('AURUM', size, tracking), H / 2 + 6, 1, () => [0x3a, 0x3f, 0x4c]);

  return c;
}

function makeIcon(size) {
  const c = canvas(size, size);
  const inset = size * 0.055;
  const r = size * 0.22;
  fillRoundedRect(c, inset, inset, size - inset, size - inset, r, (x, y) => {
    const t = y / size;
    return [lerp(0x14, 0x07, t), lerp(0x17, 0x08, t), lerp(0x1f, 0x0b, t)];
  });
  fillTriangle(c, size * 0.38, size / 2, size * 0.34, size * 0.40, gold(size));
  return c;
}

// --------------------------------------------------------------------- run

fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
const banner = encodePng(makeBanner());
fs.writeFileSync(path.join(RES, 'drawable', 'app_banner.png'), banner);
console.log(`[assets] drawable/app_banner.png  320x180  (${(banner.length / 1024).toFixed(1)} KB)`);

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  const png = encodePng(makeIcon(size));
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png);
  console.log(`[assets] mipmap-${density}/ic_launcher.png  ${size}x${size}`);
}
