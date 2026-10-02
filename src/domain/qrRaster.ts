/**
 * Crisp, offline QR rasterization for statement exports (docs/PLAN.md
 * GO-1.1): black modules on white, integer pixels per module, a quiet zone
 * of at least 4 modules and no smoothing — the QR is never part of a lossy
 * (JPEG) page capture, only ever added as its own lossless image. Pure: the
 * module matrix comes from the platform QR service.
 */

export const QR_QUIET_ZONE_MODULES = 4;
export const QR_MIN_MODULE_PX = 4;
export const QR_MIN_SIZE_PX = 300;

/** A square 8-bit grayscale bitmap: 0 = black, 255 = white. */
export interface QrBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Pixels per module: at least 4, and large enough that the whole symbol (quiet zone included) is ≥ `minSizePx` wide. */
export function chooseModulePx(moduleCount: number, minSizePx = QR_MIN_SIZE_PX): number {
  const total = moduleCount + 2 * QR_QUIET_ZONE_MODULES;
  return Math.max(QR_MIN_MODULE_PX, Math.ceil(minSizePx / total));
}

/** `modules` is row-major, `size` × `size`, truthy = dark. */
export function rasterizeQr(modules: ArrayLike<number | boolean>, size: number, modulePx: number): QrBitmap {
  const side = (size + 2 * QR_QUIET_ZONE_MODULES) * modulePx;
  const pixels = new Uint8Array(side * side).fill(255);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!modules[row * size + col]) continue;
      const x0 = (col + QR_QUIET_ZONE_MODULES) * modulePx;
      const y0 = (row + QR_QUIET_ZONE_MODULES) * modulePx;
      for (let y = y0; y < y0 + modulePx; y++) pixels.fill(0, y * side + x0, y * side + x0 + modulePx);
    }
  }
  return { width: side, height: side, pixels };
}

/** RGBA copy for canvas `putImageData` / decoders. */
export function bitmapToRgba(bitmap: QrBitmap): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
  for (let i = 0; i < bitmap.pixels.length; i++) {
    const v = bitmap.pixels[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// --- Minimal lossless PNG (1-bit grayscale, stored deflate blocks) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Array.from(type, (ch) => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** Encodes the bitmap as a 1-bit grayscale PNG (black/white only, pixel-exact, no compression artifacts). */
export function encodeQrPng(bitmap: QrBitmap): Uint8Array {
  const { width, height, pixels } = bitmap;
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    raw[base] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] >= 128) raw[base + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  // zlib wrapper around stored (uncompressed) deflate blocks.
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const slice = raw.subarray(offset, Math.min(offset + 65535, raw.length));
    const final = offset + 65535 >= raw.length ? 1 : 0;
    parts.push(Uint8Array.of(final, slice.length & 0xff, slice.length >> 8, ~slice.length & 0xff, (~slice.length >> 8) & 0xff), slice);
  }
  parts.push(Uint8Array.from(u32(adler32(raw))));
  const zlib = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    zlib.set(part, pos);
    pos += part.length;
  }

  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 1, 0, 0, 0, 0]);
  const pieces = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  pos = 0;
  for (const piece of pieces) {
    png.set(piece, pos);
    pos += piece.length;
  }
  return png;
}

export function pngToDataUrl(png: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}
