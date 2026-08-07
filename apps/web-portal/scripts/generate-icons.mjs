#!/usr/bin/env node
// Generates the PWA icon set into apps/web-portal/public with zero image
// dependencies — a tiny hand-rolled PNG encoder (Node's built-in zlib) plus a
// scalable SVG favicon. Re-run with `npm run icons` if the brand mark changes.
//
// Mark: a navy (#0f1b33) tile with an orange (#fb8b24) fuel droplet and a soft
// white highlight — matches src/styles/tokens.css (--navy / --orange).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT_DIR, { recursive: true });

const NAVY = [0x0f, 0x1b, 0x33];
const ORANGE = [0xfb, 0x8b, 0x24];
const WHITE = [0xff, 0xff, 0xff];

// ---- CRC32 (PNG chunk checksums) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// rgba: Uint8Array of size*size*4
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10..12 = compression/filter/interlace = 0
  // Filtered scanlines: one leading filter byte (0 = None) per row.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.subarray(y * stride, y * stride + stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- The mark, rasterized with 3x supersampling for smooth edges ----
// nx, ny in [0,1]. `fullBleed` fills the whole square (maskable / apple-touch);
// otherwise the tile is a rounded square with transparent corners.
function sampleColor(nx, ny, fullBleed) {
  // droplet: bottom lobe (circle) + top cone (tapering triangle)
  const dx = nx - 0.5;
  const apexY = 0.17;
  const lobeY = 0.63;
  const R = 0.27;
  const inLobe = dx * dx + (ny - lobeY) ** 2 <= R * R;
  const inCone =
    ny >= apexY && ny <= lobeY && Math.abs(dx) <= R * ((ny - apexY) / (lobeY - apexY));
  const inDrop = inLobe || inCone;
  // soft highlight inside the droplet, upper-left
  const inHighlight = (nx - 0.40) ** 2 + (ny - 0.52) ** 2 <= 0.055 ** 2;

  // tile membership
  let inTile = true;
  if (!fullBleed) {
    const ax = Math.abs(nx - 0.5);
    const ay = Math.abs(ny - 0.5);
    const half = 0.5;
    const cr = 0.18;
    if (ax > half - cr && ay > half - cr) {
      inTile = (ax - (half - cr)) ** 2 + (ay - (half - cr)) ** 2 <= cr * cr;
    }
  }

  if (!inTile) return [0, 0, 0, 0];
  if (inDrop && inHighlight) return [...WHITE, 235];
  if (inDrop) return [...ORANGE, 255];
  return [...NAVY, 255];
}
function renderIcon(size, fullBleed) {
  const SS = 3;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = sampleColor(nx, ny, fullBleed);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const i = (y * size + x) * 4;
      // premultiplied average -> straight color
      rgba[i] = alpha > 0 ? Math.round(r / a) : 0;
      rgba[i + 1] = alpha > 0 ? Math.round(g / a) : 0;
      rgba[i + 2] = alpha > 0 ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, rgba);
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, fullBleed: false },
  { file: 'pwa-512x512.png', size: 512, fullBleed: false },
  { file: 'maskable-512x512.png', size: 512, fullBleed: true },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true },
];
for (const t of targets) {
  writeFileSync(resolve(OUT_DIR, t.file), renderIcon(t.size, t.fullBleed));
  console.log('wrote', t.file);
}

// Scalable SVG favicon (crisp at any tab size), same mark.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0f1b33"/>
  <path d="M32 11 C 32 11, 49 38, 49 43 A 17 17 0 1 1 15 43 C 15 38, 32 11, 32 11 Z" fill="#fb8b24"/>
  <ellipse cx="25.5" cy="33" rx="3.4" ry="4.2" fill="#ffffff" opacity="0.9"/>
</svg>
`;
writeFileSync(resolve(OUT_DIR, 'favicon.svg'), svg);
console.log('wrote favicon.svg');
