import type { ImagePickSource, MenuPhotoService } from "../types";
import { loadImage, pickFile } from "./imageService";

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.8;

export class WebMenuPhotoService implements MenuPhotoService {
  async pickScaledPhoto(source: ImagePickSource, maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY): Promise<Blob | null> {
    const file = await pickFile(source);
    if (!file) return null;
    const image = await loadImage(file);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("پردازش تصویر پشتیبانی نمی‌شود");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("فشرده‌سازی تصویر ناموفق بود"))), "image/webp", quality);
    });
  }
}
