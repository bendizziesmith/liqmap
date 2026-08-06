/**
 * Generate the PWA icons as real PNGs with no image dependency.
 *
 * The icon is a miniature of the product: inferno-coloured horizontal liquidation bands on
 * the app's near-black background.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const STOPS = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [106, 23, 110],
  [147, 38, 103],
  [188, 55, 84],
  [221, 81, 58],
  [243, 120, 25],
  [252, 165, 10],
  [246, 215, 70],
  [252, 255, 164],
];

function inferno(x) {
  const t = Math.min(1, Math.max(0, x)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each scanline is prefixed with its filter type byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bands at these vertical positions, each with an intensity and a falloff. */
const BANDS = [
  { at: 0.2, heat: 0.55, spread: 0.035 },
  { at: 0.33, heat: 0.95, spread: 0.05 },
  { at: 0.46, heat: 0.3, spread: 0.03 },
  { at: 0.62, heat: 1.0, spread: 0.055 },
  { at: 0.76, heat: 0.45, spread: 0.032 },
  { at: 0.87, heat: 0.7, spread: 0.04 },
];

function render(size, inset) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;

      // Rounded-square mask, inset for the maskable variant's safe zone.
      const pad = inset * size;
      const cx = Math.max(pad + radius - x, x - (size - pad - radius), 0);
      const cy = Math.max(pad + radius - y, y - (size - pad - radius), 0);
      const outside =
        Math.hypot(cx, cy) > radius ||
        x < pad ||
        y < pad ||
        x > size - pad ||
        y > size - pad;
      if (outside) {
        px[i + 3] = 0;
        continue;
      }

      let heat = 0;
      for (const b of BANDS) {
        const d = Math.abs(v - b.at);
        // Bands fade toward the left edge so the icon reads as time flowing rightward.
        heat += b.heat * Math.exp(-(d * d) / (2 * b.spread * b.spread)) * (0.35 + 0.65 * u);
      }

      const [r, g, bl] = inferno(Math.min(1, heat));
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = bl;
      px[i + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });

for (const [name, size, inset] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable.png', 512, 0.1],
]) {
  writeFileSync(join(OUT, name), png(size, render(size, inset)));
  console.log('wrote', name);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#07070b"/>
  <rect x="6" y="13" width="52" height="4" rx="2" fill="#96266b" opacity="0.75"/>
  <rect x="6" y="21" width="52" height="6" rx="3" fill="#f5a20a"/>
  <rect x="6" y="31" width="52" height="3" rx="1.5" fill="#6a0a68" opacity="0.8"/>
  <rect x="6" y="39" width="52" height="7" rx="3.5" fill="#fcffa4"/>
  <rect x="6" y="50" width="52" height="4" rx="2" fill="#dd5136" opacity="0.85"/>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
