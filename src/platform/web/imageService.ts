import type { ImagePickSource, ImageService } from "../types";

const DEFAULT_MAX_SIZE = 256;
const DEFAULT_QUALITY = 0.75;

function pickFile(source: ImagePickSource): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.capture = "environment";
    input.style.display = "none";

    const cleanup = () => input.remove();

    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        resolve(file);
      },
      { once: true }
    );
    // No reliable "cancel" event across browsers; resolve(null) is left to
    // the caller's own timeout/UI if ever needed — for now the picker sheet
    // just stays open until change fires.
    document.body.appendChild(input);
    input.click();
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("تصویر انتخاب‌شده قابل خواندن نیست"));
    };
    image.src = url;
  });
}

function cropToSquareAndCompress(image: HTMLImageElement, maxSize: number, quality: number): Promise<Blob> {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  const outputSize = Math.min(maxSize, side);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("پردازش تصویر پشتیبانی نمی‌شود");
  ctx.drawImage(image, sx, sy, side, side, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("فشرده‌سازی تصویر ناموفق بود"));
      },
      "image/webp",
      quality
    );
  });
}

export class WebImageService implements ImageService {
  async pickSquarePhoto(source: ImagePickSource, maxSize = DEFAULT_MAX_SIZE, quality = DEFAULT_QUALITY): Promise<Blob | null> {
    const file = await pickFile(source);
    if (!file) return null;
    const image = await loadImage(file);
    return cropToSquareAndCompress(image, maxSize, quality);
  }
}
