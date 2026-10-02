import QRCode from "qrcode";
import type { QrService } from "../types";

export class WebQrService implements QrService {
  async toDataUrl(text: string, widthPx = 240): Promise<string | null> {
    try {
      return await QRCode.toDataURL(text, { errorCorrectionLevel: "L", margin: 1, width: widthPx });
    } catch {
      // Raised when the text exceeds a QR code's capacity.
      return null;
    }
  }
}
