/**
 * Shared send-menu logic (docs/PLAN.md Stage 3C) behind both the
 * single-statement SendMenuSheet and the multi-member SendQueueScreen, so
 * the two stay consistent: same link/summary text, same file export path,
 * same fallback behavior.
 */
import { APP_VERSION } from "@/config/app";
import type { Statement } from "@/data/types";
import { buildStatementExportFilenameBase } from "@/domain/exportNaming";
import { normalizeIranianPhone } from "@/domain/phoneNormalization";
import { buildStatementSummaryText } from "@/domain/sendSummary";
import { buildSmsUrl, buildTelegramUrl, buildWhatsAppUrl } from "@/domain/sendUrls";
import { buildStatementLink, type StatementLinkData, type StatementLinkPayload } from "@/domain/statementLink";
import { platform, shareService } from "@/platform";
import type { ExportedFile } from "@/platform/types";
import { captureStatementFilesOffscreen, statementPaperMeta } from "./offscreenExport";

function statementLinkBaseUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** "person id or 'event'" — the comprehensive report has no single recipient (docs/PLAN.md Stage 3C sendLog target). */
export function targetOf(data: StatementLinkData): string {
  return data.kind === "comprehensive" ? "event" : data.member.personId;
}

export function memberLabelOf(data: StatementLinkData): string {
  return data.kind === "comprehensive" ? "گزارش جامع" : `${data.member.firstName} ${data.member.lastName}`.trim();
}

/** Builds the statement-link payload and its size-tiered URL, then the channel-specific summary text. */
export function buildLinkAndSummary(statement: Statement, data: StatementLinkData, eventTitle: string, phone?: string | null) {
  const payload: StatementLinkPayload = {
    v: 1,
    statementId: statement.id,
    number: statement.number,
    issueVersion: statement.issueVersion,
    issuedAt: statement.issuedAt,
    verificationCode: statement.verificationCode,
    status: statement.status,
    appVersion: APP_VERSION,
    data
  };
  const link = buildStatementLink(payload, statementLinkBaseUrl());
  const normalizedPhone = normalizeIranianPhone(phone);

  const summaryText =
    data.kind === "comprehensive"
      ? [`گزارش جامع رویداد «${eventTitle}»`, link.url ?? "برای دریافت گزارش کامل با مسئول صندوق در تماس باشید"].join("\n")
      : buildStatementSummaryText({
          firstName: data.member.firstName,
          eventTitle,
          balance: data.summary.balance,
          currency: data.event.currency,
          treasurerName: data.treasurerName,
          treasurerCardNumberGrouped: data.treasurerCardNumberGrouped,
          treasurerIbanGrouped: data.treasurerIbanGrouped,
          link: link.url
        });

  return { normalizedPhone, summaryText, link };
}

export function openWhatsApp(statement: Statement, data: StatementLinkData, eventTitle: string, phone?: string | null): void {
  const { normalizedPhone, summaryText } = buildLinkAndSummary(statement, data, eventTitle, phone);
  shareService.openUrl(buildWhatsAppUrl(normalizedPhone, summaryText));
}

export function openTelegram(statement: Statement, data: StatementLinkData, eventTitle: string, phone?: string | null): void {
  const { summaryText, link } = buildLinkAndSummary(statement, data, eventTitle, phone);
  shareService.openUrl(buildTelegramUrl(link.url, summaryText));
}

export function openSms(statement: Statement, data: StatementLinkData, eventTitle: string, phone?: string | null): void {
  const { normalizedPhone, summaryText } = buildLinkAndSummary(statement, data, eventTitle, phone);
  shareService.openUrl(buildSmsUrl(normalizedPhone, summaryText, platform.getInfo().os === "ios"));
}

export interface FileShareResult {
  ok: boolean;
  /** Set when the share fell back to a plain download or failed outright. */
  message?: string;
}

/** Exports one statement (offscreen, per docs/PLAN.md Stage 3C) as PDF or images and shares/downloads it. */
export async function shareStatementFile(
  statement: Statement,
  data: StatementLinkData,
  eventTitle: string,
  kind: "pdf" | "image"
): Promise<FileShareResult> {
  const filenameBase = buildStatementExportFilenameBase(eventTitle, memberLabelOf(data), statement.number);
  const files = await captureStatementFilesOffscreen(data, statementPaperMeta(statement), kind, filenameBase);
  if (files.length === 0) return { ok: false, message: "محتوایی برای خروجی گرفتن پیدا نشد." };

  if (shareService.canShareFiles(files.map((f) => f.mimeType))) {
    await shareService.shareFiles(files.map((f) => ({ data: f.blob, filename: f.filename, mimeType: f.mimeType })));
    return { ok: true };
  }

  files.forEach((f) => shareService.downloadFile(f.blob, f.filename));
  return { ok: true, message: "اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود؛ فایل دانلود شد." };
}

/** "همه در یک گفتگو" (docs/PLAN.md Stage 3C bulk sending): exports every selected member's statement and shares them all in one call, falling back to sequential shares/downloads. */
export async function shareStatementFilesBulk(
  entries: { statement: Statement; data: StatementLinkData }[],
  eventTitle: string,
  kind: "pdf" | "image"
): Promise<FileShareResult> {
  const allFiles: ExportedFile[] = [];
  for (const { statement, data } of entries) {
    const filenameBase = buildStatementExportFilenameBase(eventTitle, memberLabelOf(data), statement.number);
    const files = await captureStatementFilesOffscreen(data, statementPaperMeta(statement), kind, filenameBase);
    allFiles.push(...files);
  }
  if (allFiles.length === 0) return { ok: false, message: "محتوایی برای خروجی گرفتن پیدا نشد." };

  if (shareService.canShareFiles(allFiles.map((f) => f.mimeType))) {
    await shareService.shareFiles(allFiles.map((f) => ({ data: f.blob, filename: f.filename, mimeType: f.mimeType })));
    return { ok: true };
  }

  allFiles.forEach((f) => shareService.downloadFile(f.blob, f.filename));
  return { ok: true, message: "اشتراک‌گذاری گروهی در این مرورگر پشتیبانی نمی‌شود؛ فایل‌ها دانلود شدند." };
}
