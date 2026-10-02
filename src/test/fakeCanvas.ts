/**
 * A tiny software canvas for jsdom (which has no 2D context): enough of the
 * API for the export pipeline — fills, drawImage (nearest neighbour),
 * putImageData, text calls recorded — plus real PNG output via pngjs so a
 * produced bitmap can be decoded again by a QR reader in tests.
 */
import { PNG } from "pngjs";

export interface DrawCall {
  source: FakeCanvas;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  smoothing: boolean;
}

export interface FakeCanvas extends HTMLCanvasElement {
  __rgba: Uint8ClampedArray;
  __draws: DrawCall[];
  __texts: { text: string; x: number; y: number; align: string }[];
}

function parseColor(style: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  return [0, 0, 0, 255];
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number
  ) {}
}

export function installFakeCanvas(): void {
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;

  const contexts = new WeakMap<HTMLCanvasElement, unknown>();

  HTMLCanvasElement.prototype.getContext = function (this: FakeCanvas) {
    if (contexts.has(this)) return contexts.get(this) as never;
    const canvas = this;
    canvas.__draws = [];
    canvas.__texts = [];
    const buffer = () => {
      if (!canvas.__rgba || canvas.__rgba.length !== canvas.width * canvas.height * 4) canvas.__rgba = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      return canvas.__rgba;
    };
    const ctx = {
      fillStyle: "#000000" as string,
      font: "",
      direction: "ltr",
      textAlign: "left",
      textBaseline: "alphabetic",
      imageSmoothingEnabled: true,
      fillRect(x: number, y: number, w: number, h: number) {
        const rgba = buffer();
        const [r, g, b, a] = parseColor(ctx.fillStyle);
        for (let yy = Math.max(0, y); yy < Math.min(canvas.height, y + h); yy++) {
          for (let xx = Math.max(0, x); xx < Math.min(canvas.width, x + w); xx++) {
            const i = (yy * canvas.width + xx) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = a;
          }
        }
      },
      fillText(text: string, x: number, y: number) {
        canvas.__texts.push({ text, x, y, align: ctx.textAlign });
      },
      putImageData(image: FakeImageData, x: number, y: number) {
        const rgba = buffer();
        for (let yy = 0; yy < image.height; yy++) {
          for (let xx = 0; xx < image.width; xx++) {
            const si = (yy * image.width + xx) * 4;
            const di = ((y + yy) * canvas.width + (x + xx)) * 4;
            for (let k = 0; k < 4; k++) rgba[di + k] = image.data[si + k];
          }
        }
      },
      drawImage(source: FakeCanvas, ...args: number[]) {
        let [sx, sy, sw, sh, dx, dy, dw, dh] = [0, 0, source.width, source.height, 0, 0, source.width, source.height];
        if (args.length === 4) [dx, dy, dw, dh] = args;
        else if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
        canvas.__draws.push({ source, sx, sy, sw, sh, dx, dy, dw, dh, smoothing: ctx.imageSmoothingEnabled });
        const dst = buffer();
        const src = source.__rgba ?? new Uint8ClampedArray(source.width * source.height * 4).fill(255);
        for (let yy = 0; yy < dh; yy++) {
          for (let xx = 0; xx < dw; xx++) {
            const tx = dx + xx;
            const ty = dy + yy;
            if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
            const px = Math.min(source.width - 1, Math.floor(sx + (xx * sw) / dw));
            const py = Math.min(source.height - 1, Math.floor(sy + (yy * sh) / dh));
            const si = (py * source.width + px) * 4;
            const di = (ty * canvas.width + tx) * 4;
            for (let k = 0; k < 4; k++) dst[di + k] = src[si + k];
          }
        }
      }
    };
    contexts.set(canvas, ctx);
    return ctx as never;
  } as never;

  HTMLCanvasElement.prototype.toBlob = function (this: FakeCanvas, callback: BlobCallback, type?: string) {
    const canvas = this;
    if (type === "image/png") {
      const png = new PNG({ width: canvas.width, height: canvas.height });
      png.data = Buffer.from(canvas.__rgba ?? new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255));
      callback(new Blob([new Uint8Array(PNG.sync.write(png))], { type: "image/png" }));
    } else {
      callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: type ?? "image/jpeg" }));
    }
  } as never;

  HTMLCanvasElement.prototype.toDataURL = function () {
    return "data:image/jpeg;base64,/9j/2wA=";
  } as never;
}

/** A blank white fake canvas, as `domToCanvas` would return for the page capture. */
export function whiteCanvas(width: number, height: number): FakeCanvas {
  const canvas = document.createElement("canvas") as FakeCanvas;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d");
  canvas.__rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  return canvas;
}
