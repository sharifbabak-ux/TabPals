import jsQR from "jsqr";
import type { QrScanService } from "../types";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options?: { formats: string[] }) => BarcodeDetectorLike;

/** Camera QR scanner: native `BarcodeDetector` when present, jsQR on canvas frames otherwise. */
export class WebQrScanService implements QrScanService {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async start(video: HTMLVideoElement, onResult: (text: string) => void): Promise<() => void> {
    if (!this.isSupported()) throw new Error("دوربین در این مرورگر در دسترس نیست؛ کد دعوت را تایپ کنید.");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch {
      throw new Error("اجازه‌ی استفاده از دوربین داده نشد؛ کد دعوت را تایپ کنید.");
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    await video.play().catch(() => undefined);

    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    let stopped = false;
    let timer = 0;
    const tick = async () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
          let text: string | null = null;
          if (detector) {
            const found = await detector.detect(video);
            text = found[0]?.rawValue ?? null;
          } else if (context) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
          if (text && !stopped) {
            stopped = true;
            stop();
            onResult(text);
            return;
          }
        } catch {
          // a bad frame — try the next one
        }
      }
      timer = window.setTimeout(tick, 200);
    };

    function stop() {
      stopped = true;
      window.clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    timer = window.setTimeout(tick, 200);
    return stop;
  }
}
