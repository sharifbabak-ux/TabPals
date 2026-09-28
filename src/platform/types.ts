/**
 * Platform abstraction layer.
 *
 * Every feature that touches something platform-specific (files, sharing,
 * speech input, ...) must go through one of these interfaces instead of
 * calling browser/Capacitor APIs directly. This lets Stage 9 add native
 * Android/iOS implementations without touching any UI or domain code.
 */

export type PlatformKind = "web" | "android" | "ios";

export interface PlatformInfo {
  /** Which runtime this build is executing on. */
  kind: PlatformKind;
  /** Whether the app is running installed/standalone (vs. a browser tab). */
  isStandalone: boolean;
}

export interface Platform {
  getInfo(): PlatformInfo;
}

export interface StoredFileMeta {
  name: string;
  createdAt: string;
  size: number;
}

/**
 * Saving/reading arbitrary files and managing rotating backup sets
 * (see docs/PLAN.md Stage 6 — Backup). Directory semantics differ per
 * platform (in-app storage on web, a visible device folder on Android),
 * so callers only ever see file names, never paths.
 */
export interface FileService {
  saveFile(name: string, data: Blob): Promise<void>;
  readFile(name: string): Promise<Blob | null>;
  deleteFile(name: string): Promise<void>;
  listFiles(): Promise<StoredFileMeta[]>;
  /** Keeps only the newest `maxCount` files, deleting the oldest. */
  rotateBackups(maxCount: number): Promise<void>;
}

/**
 * Hands a file or plain text to the OS/browser share sheet
 * (WhatsApp/Telegram/etc. on Android, Web Share API on web).
 */
export interface ShareService {
  isSupported(): boolean;
  shareFile(data: Blob, filename: string, mimeType: string): Promise<void>;
  shareText(text: string, title?: string): Promise<void>;
}

export type ImagePickSource = "camera" | "gallery";

/**
 * Picks an image (camera or gallery) for a person's avatar and returns it
 * center-cropped to a square, resized to at most maxSize×maxSize, and
 * compressed (WebP or JPEG, ~0.75 quality) — see CLAUDE.md Data rules and
 * docs/PLAN.md Stage 3A UI #9. Cropping needs a canvas, so this stays in
 * src/platform rather than src/domain. Returns null if the user cancels.
 */
export interface ImageService {
  pickSquarePhoto(source: ImagePickSource, maxSize?: number, quality?: number): Promise<Blob | null>;
}

export interface SpeechRecognitionResult {
  transcript: string;
  isFinal: boolean;
}

/**
 * Speech-to-text for voice-entered expense descriptions
 * (see docs/PLAN.md Stage 5 — Attachments & voice).
 */
export interface SpeechService {
  isSupported(): boolean;
  startListening(
    onResult: (result: SpeechRecognitionResult) => void,
    onError?: (error: Error) => void
  ): void;
  stopListening(): void;
}
