import jsQR from "jsqr";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { QR_MIN_MODULE_PX, QR_MIN_SIZE_PX, QR_QUIET_ZONE_MODULES, bitmapToRgba, chooseModulePx, encodeQrPng, rasterizeQr } from "./qrRaster";

describe("qr raster", () => {
  it("picks ≥ 4 px per module and a symbol ≥ 300 px", () => {
    for (const modules of [21, 45, 65, 85, 177]) {
      const px = chooseModulePx(modules);
      expect(px).toBeGreaterThanOrEqual(QR_MIN_MODULE_PX);
      expect((modules + 2 * QR_QUIET_ZONE_MODULES) * px).toBeGreaterThanOrEqual(Math.min(QR_MIN_SIZE_PX, (modules + 8) * QR_MIN_MODULE_PX));
    }
    expect((65 + 8) * chooseModulePx(65)).toBeGreaterThanOrEqual(QR_MIN_SIZE_PX);
  });

  it("rasterizes with a white quiet zone and survives a PNG round trip and a QR decode", () => {
    const text = "https://example.com/TabPals/#/s/abcdef";
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const modulePx = chooseModulePx(qr.modules.size);
    const bitmap = rasterizeQr(qr.modules.data, qr.modules.size, modulePx);
    expect(bitmap.width).toBe((qr.modules.size + 8) * modulePx);
    // Quiet zone: first 4 modules of rows/columns are all white.
    for (let i = 0; i < QR_QUIET_ZONE_MODULES * modulePx; i++) {
      expect(bitmap.pixels[i * bitmap.width + 5]).toBe(255);
      expect(bitmap.pixels[5 * bitmap.width + i]).toBe(255);
    }
    const png = PNG.sync.read(Buffer.from(encodeQrPng(bitmap)));
    expect(png.width).toBe(bitmap.width);
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(text);
    expect(jsQR(bitmapToRgba(bitmap), bitmap.width, bitmap.height)?.data).toBe(text);
  });
});
