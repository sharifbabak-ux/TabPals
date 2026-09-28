import type { SpeechRecognitionResult, SpeechService } from "../types";

/**
 * Web Speech API (fa-IR) wiring belongs to Stage 5 — Attachments & voice.
 * This stub only establishes the interface shape.
 */
export class WebSpeechService implements SpeechService {
  isSupported(): boolean {
    return false;
  }

  startListening(
    _onResult: (result: SpeechRecognitionResult) => void,
    _onError?: (error: Error) => void
  ): void {
    throw new Error("گفتار به متن هنوز پیاده‌سازی نشده است (Stage 5)");
  }

  stopListening(): void {
    throw new Error("گفتار به متن هنوز پیاده‌سازی نشده است (Stage 5)");
  }
}
