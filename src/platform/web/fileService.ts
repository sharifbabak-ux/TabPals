import type { FileService, StoredFileMeta } from "../types";

/**
 * Backup file storage (save/list/rotate) is implemented in Stage 6.
 * This stub only establishes the interface shape so later stages and
 * Stage 9's native implementation have a stable contract to target.
 */
export class WebFileService implements FileService {
  async saveFile(_name: string, _data: Blob): Promise<void> {
    throw new Error("پشتیبان‌گیری هنوز پیاده‌سازی نشده است (Stage 6)");
  }

  async readFile(_name: string): Promise<Blob | null> {
    throw new Error("پشتیبان‌گیری هنوز پیاده‌سازی نشده است (Stage 6)");
  }

  async deleteFile(_name: string): Promise<void> {
    throw new Error("پشتیبان‌گیری هنوز پیاده‌سازی نشده است (Stage 6)");
  }

  async listFiles(): Promise<StoredFileMeta[]> {
    throw new Error("پشتیبان‌گیری هنوز پیاده‌سازی نشده است (Stage 6)");
  }

  async rotateBackups(_maxCount: number): Promise<void> {
    throw new Error("پشتیبان‌گیری هنوز پیاده‌سازی نشده است (Stage 6)");
  }
}
