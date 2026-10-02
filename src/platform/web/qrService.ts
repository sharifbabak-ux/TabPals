import QRCode from "qrcode";
import { bitmapToRgba, chooseModulePx, encodeQrPng, pngToDataUrl, rasterizeQr } from "@/domain/qrRaster";
import type { QrImage, QrService } from "../types";

export class WebQrService implements QrService {
  async render(text: string): Promise<QrImage | null> {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
      const moduleCount = qr.modules.size;
      const modulePx = chooseModulePx(moduleCount);
      const bitmap = rasterizeQr(qr.modules.data, moduleCount, modulePx);
      return {
        dataUrl: pngToDataUrl(encodeQrPng(bitmap)),
        sizePx: bitmap.width,
        moduleCount,
        modulePx,
        rgba: bitmapToRgba(bitmap)
      };
    } catch {
      // Raised when the text exceeds a QR code's capacity.
      return null;
    }
  }
}
