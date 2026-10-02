export * from "./types";
export { requestPersistentStorageOnce } from "./web/storage";

import { WebPlatform } from "./web/platform";
import { WebFileService } from "./web/fileService";
import { WebShareService } from "./web/shareService";
import { WebSpeechService } from "./web/speechService";
import { WebImageService } from "./web/imageService";
import { WebExportService } from "./web/exportService";

/**
 * Active platform service instances. Stage 9 swaps these for
 * android/ios implementations behind the same interfaces — nothing
 * outside src/platform should change.
 */
export const platform = new WebPlatform();
export const fileService = new WebFileService();
export const shareService = new WebShareService();
export const speechService = new WebSpeechService();
export const imageService = new WebImageService();
export const exportService = new WebExportService();
