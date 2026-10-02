import type { ShareableFile, ShareService } from "../types";

/** Web Share API implementation. Falls back to the clipboard for text and to a plain download for files. */
export class WebShareService implements ShareService {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && "share" in navigator;
  }

  canShareFiles(mimeTypes: string[]): boolean {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    const probeFiles = mimeTypes.map((type, index) => new File([""], `probe-${index}`, { type }));
    try {
      return navigator.canShare({ files: probeFiles });
    } catch {
      return false;
    }
  }

  async shareFile(data: Blob, filename: string, mimeType: string): Promise<void> {
    const file = new File([data], filename, { type: mimeType });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    throw new Error("اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود");
  }

  async shareFiles(files: ShareableFile[]): Promise<void> {
    const fileObjects = files.map((f) => new File([f.data], f.filename, { type: f.mimeType }));
    if (navigator.canShare?.({ files: fileObjects })) {
      await navigator.share({ files: fileObjects });
      return;
    }
    // Fallback: sequential single-file shares (docs/PLAN.md Stage 3C "همه در یک گفتگو").
    for (const file of fileObjects) {
      if (!navigator.canShare?.({ files: [file] })) {
        throw new Error("اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود");
      }
      await navigator.share({ files: [file] });
    }
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

  downloadFile(data: Blob, filename: string): void {
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  openUrl(url: string): void {
    // Custom URI schemes (sms:) are unreliable with window.open in some browsers.
    if (url.startsWith("sms:") || url.startsWith("tel:")) {
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener");
  }
}
