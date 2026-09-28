// Generates placeholder PWA/app icons (a bold letter "T" on a solid
// background) as real PNG files, with no external image dependencies —
// only Node's built-in zlib for deflate + a hand-rolled PNG encoder.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const BG = [79, 70, 229]; // indigo-600, matches theme_color family
const FG = [255, 255, 255];

function makeCanvas(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = BG[0];
    px[i * 4 + 1] = BG[1];
    px[i * 4 + 2] = BG[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}

function fillRect(px, size, x, y, w, h, color) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(size, Math.round(x + w));
  const y1 = Math.min(size, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * size + xx) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

// Draws a bold letter "T" centered in a box [boxX, boxY, boxSize].
function drawT(px, size, boxX, boxY, boxSize) {
  const barH = boxSize * 0.18;
  const stemW = boxSize * 0.22;
  fillRect(px, size, boxX, boxY, boxSize, barH, FG);
  fillRect(px, size, boxX + boxSize / 2 - stemW / 2, boxY, stemW, boxSize, FG);
}

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) {
      raw[rowStart + 1 + x] = px[y * size * 4 + x];
    }
  }
  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function renderIcon(size, { maskable = false } = {}) {
  const px = makeCanvas(size);
  const boxRatio = maskable ? 0.45 : 0.6; // maskable needs extra safe-zone padding
  const boxSize = size * boxRatio;
  drawT(px, size, (size - boxSize) / 2, (size - boxSize) / 2, boxSize);
  return encodePNG(px, size);
}

const iconsDir = resolve(root, "public", "icons");
mkdirSync(iconsDir, { recursive: true });

writeFileSync(resolve(iconsDir, "icon-192.png"), renderIcon(192));
writeFileSync(resolve(iconsDir, "icon-512.png"), renderIcon(512));
writeFileSync(resolve(iconsDir, "icon-maskable-512.png"), renderIcon(512, { maskable: true }));
writeFileSync(resolve(root, "public", "apple-touch-icon.png"), renderIcon(180));

console.log("icons generated in public/icons and public/apple-touch-icon.png");
