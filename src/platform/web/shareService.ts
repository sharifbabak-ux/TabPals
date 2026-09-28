import type { ShareService } from "../types";

/** Web Share API implementation. Falls back to the clipboard for text. */
export class WebShareService implements ShareService {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && "share" in navigator;
  }

  async shareFile(data: Blob, filename: string, mimeType: string): Promise<void> {
    const file = new File([data], filename, { type: mimeType });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    throw new Error("اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود");
  }

  async shareText(text: string, title?: string): Promise<void> {
    if (this.isSupported()) {
      await navigator.share({ text, title });
      return;
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error("اشتراک‌گذاری متن در این مرورگر پشتیبانی نمی‌شود");
  }
}
