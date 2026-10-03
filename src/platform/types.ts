/**
 * Platform abstraction layer.
 *
 * Every feature that touches something platform-specific (files, sharing,
 * speech input, ...) must go through one of these interfaces instead of
 * calling browser/Capacitor APIs directly. This lets Stage 9 add native
 * Android/iOS implementations without touching any UI or domain code.
 */

export type PlatformKind = "web" | "android" | "ios";

/** The device's actual OS, detected even on the web build (docs/PLAN.md Stage 3C — the sms: URI's body separator differs by OS). */
export type PlatformOS = "ios" | "android" | "other";

export interface PlatformInfo {
  /** Which runtime this build is executing on. */
  kind: PlatformKind;
  /** Whether the app is running installed/standalone (vs. a browser tab). */
  isStandalone: boolean;
  os: PlatformOS;
  /** Short human label of this device/browser (≤ 40 chars), e.g. "Android Chrome" — sent to the server as the device label. */
  deviceLabel: string;
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

export interface ShareableFile {
  data: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Hands a file or plain text to the OS/browser share sheet
 * (WhatsApp/Telegram/etc. on Android, Web Share API on web).
 */
export interface ShareService {
  isSupported(): boolean;
  /** Whether files of the given MIME types can be shared in one call (docs/PLAN.md Stage 3C "همه در یک گفتگو"). */
  canShareFiles(mimeTypes: string[]): boolean;
  shareFile(data: Blob, filename: string, mimeType: string): Promise<void>;
  /** Shares several files in one share-sheet call; falls back to sequential single-file shares if the platform can't share them together. */
  shareFiles(files: ShareableFile[]): Promise<void>;
  shareText(text: string, title?: string): Promise<void>;
  /** Saves a file straight to the user's downloads — the fallback when file sharing isn't supported at all. */
  downloadFile(data: Blob, filename: string): void;
  /** Opens a wa.me/t.me/sms: link. Native Android replaces this in Stage 9 with a direct app Intent carrying the file. */
  openUrl(url: string): void;
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

/**
 * Picks an image (camera or gallery) and returns it scaled down so its longer
 * side is at most `maxDimension` and compressed (WebP, ~0.8 quality) — for
 * non-avatar photos such as a restaurant menu (docs/PLAN.md Group Order).
 * Returns null if the user cancels.
 */
export interface MenuPhotoService {
  pickScaledPhoto(source: ImagePickSource, maxDimension?: number, quality?: number): Promise<Blob | null>;
}

/** Copies plain text to the clipboard. Resolves false when the platform refuses. */
export interface ClipboardService {
  copyText(text: string): Promise<boolean>;
}

/** A rendered QR code: crisp black-on-white PNG (docs/PLAN.md GO-1.1), pixel-exact and lossless. */
export interface QrImage {
  /** `data:image/png;base64,…` — used for on-screen display and as the separate lossless image in a PDF. */
  dataUrl: string;
  /** Side length in pixels (the symbol is square), quiet zone included. */
  sizePx: number;
  moduleCount: number;
  modulePx: number;
  /** Row-major RGBA, `sizePx` × `sizePx`, for drawing onto an export canvas without decoding the PNG. */
  rgba: Uint8ClampedArray;
}

/** Generates a QR code fully offline (docs/PLAN.md Stage 3C statement QR). */
export interface QrService {
  /** Error correction "M", ≥ 4-module quiet zone, ≥ 4 px per module, ≥ 300 px wide; null when `text` doesn't fit in a QR code. */
  render(text: string): Promise<QrImage | null>;
}

export interface ExportedFile {
  blob: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Renders an already-laid-out statement/report DOM element (the print/A4
 * view) to downloadable/shareable files (docs/PLAN.md Stage 3C). Web
 * implementation now; native Android/iOS can replace it in Stage 9 without
 * touching UI code. The element is expected to mark its repeated header
 * with `data-export-header` and its page-break-safe sections/rows with
 * `data-export-block`, matching the print stylesheet's own section breaks.
 */
export interface ExportOptions {
  /**
   * The statement QR. The element marks its placeholder with `data-export-qr`
   * (an invisible slot during capture); the QR is then added as a separate
   * lossless image on top of the page — never part of the JPEG capture.
   */
  qr?: QrImage | null;
}

export interface ExportService {
  /** Image-based, paginated A4 PDF (Persian shaping must be pixel-perfect, so this is a screenshot, not text). The QR is a separate PNG; link areas become real link annotations. */
  exportPdf(element: HTMLElement, filenameBase: string, options?: ExportOptions): Promise<ExportedFile>;
  /** One or more full-resolution lossless PNG A4 pages with a fixed footer ("(۱ از ۳)", code, version). */
  exportImages(element: HTMLElement, filenameBase: string, options?: ExportOptions): Promise<ExportedFile[]>;
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
