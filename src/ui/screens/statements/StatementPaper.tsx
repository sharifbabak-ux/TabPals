import type { Ref } from "react";
import { toPersianDigits } from "@/domain/format";
import type { StatementLinkData } from "@/domain/statementLink";
import type { QrImage } from "@/platform/types";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Logo } from "@/ui/components/Logo";
import { Avatar } from "@/ui/components/Avatar";
import { MemberStatementView } from "./MemberStatementView";
import { ComprehensiveReportView } from "./ComprehensiveReportView";
import "./StatementView.css";

/** The export captures at 2×, so a QR of N raster px occupies N/2 CSS px and is drawn back 1:1 (no resampling). */
export const QR_EXPORT_SCALE = 2;

export interface StatementPaperMeta {
  number: number;
  issueVersion: number;
  issuedAt: string;
  verificationCode: string;
  status: "current" | "outdated";
  appVersion: string;
  /** A live, unissued preview (a member's «صورت‌حساب من»): no number/version/verification code. */
  preview?: boolean;
  /**
   * The statement's online-version block (docs/PLAN.md Stage 3C, GO-1.1):
   * `qr` encodes the compact summary link, `url` is where the clickable
   * "مشاهده‌ی نسخه‌ی آنلاین" text points (full link when it fits, else the
   * summary link). Omitted entirely (e.g. on the shared-link view) = no
   * link area at all; `url: null` = nothing could be encoded, so a
   * fallback message is shown instead of the QR.
   */
  link?: { url: string | null; qr: QrImage | null };
}

interface StatementPaperProps {
  data: StatementLinkData;
  meta: StatementPaperMeta;
  /** Passed straight to the root `<article>` — used both on-screen (StatementViewScreen) and for the offscreen bulk-export render. */
  innerRef?: Ref<HTMLElement>;
  /** On-screen only: mask card numbers / IBANs until tapped. */
  maskPayment?: boolean;
  /** The «عدم چاپ شماره‌کارت و شبا» setting: payment details are left out of the printed page. */
  hidePaymentOnPrint?: boolean;
}

/**
 * The statement/report "paper": shared between the DB-backed statement
 * view, the no-server shared-link view, and the offscreen render used for
 * bulk export (docs/PLAN.md Stage 3C) — one markup source so all three stay
 * visually identical and the print/export CSS only has to target one shape.
 */
export function StatementPaper({ data, meta, innerRef, maskPayment = false, hidePaymentOnPrint = false }: StatementPaperProps) {
  return (
    <article className={hidePaymentOnPrint ? "statement-paper statement-paper--hide-payment" : "statement-paper"} ref={innerRef} data-export-verification={meta.verificationCode} data-export-app-version={meta.appVersion}>
      <header className="statement-header" data-export-header>
        <Logo variant="mark" size={44} />
        <div className="statement-header__title">
          <strong>TabPals – حساب دوستانه</strong>
          <span>{data.event.title}</span>
          {(data.event.startDate || data.event.endDate) && (
            <span className="statement-header__dates">
              {data.event.startDate && <JalaliDate date={new Date(data.event.startDate)} />}
              {data.event.startDate && data.event.endDate && " تا "}
              {data.event.endDate && <JalaliDate date={new Date(data.event.endDate)} />}
            </span>
          )}
        </div>
        {data.kind !== "comprehensive" && (
          <div className="statement-header__member">
            <Avatar id={data.member.personId} name={`${data.member.firstName} ${data.member.lastName}`.trim()} size={48} />
            <span>{`${data.member.firstName} ${data.member.lastName}`.trim()}</span>
          </div>
        )}
        <div className="statement-header__meta">
          {meta.preview ? (
            <>
              <span>
                <JalaliDate date={new Date(meta.issuedAt)} weekday time />
              </span>
              <span className="badge">پیش‌نمایش زنده — صادر نشده</span>
            </>
          ) : (
            <>
              <span>شماره {toPersianDigits(meta.number)}</span>
              <span>نسخه {toPersianDigits(meta.issueVersion)}</span>
              <span>
                <JalaliDate date={new Date(meta.issuedAt)} weekday time />
              </span>
              {meta.status === "outdated" ? <span className="badge">نیازمند صدور مجدد</span> : <span className="badge badge--closed">پایان‌یافته</span>}
            </>
          )}
        </div>
      </header>

      {data.kind === "comprehensive" ? <ComprehensiveReportView data={data} /> : <MemberStatementView data={data} closingText={data.closingText} maskPayment={maskPayment} />}

      {meta.link && (
        <section className="statement-online" data-export-block>
          {meta.link.url && meta.link.qr ? (
            <div className="statement-online__link" data-export-link data-href={meta.link.url}>
              {/* Invisible while the page is captured; the PNG is drawn on top afterwards so it stays lossless (see ExportService). */}
              <img
                className="statement-online__qr"
                data-export-qr
                src={meta.link.qr.dataUrl}
                alt="QR"
                width={meta.link.qr.sizePx / QR_EXPORT_SCALE}
                height={meta.link.qr.sizePx / QR_EXPORT_SCALE}
              />
              <a className="statement-online__label" href={meta.link.url} target="_blank" rel="noreferrer">
                مشاهده‌ی نسخه‌ی آنلاین
              </a>
            </div>
          ) : (
            <p className="statement-online__fallback">برای نسخه‌ی آنلاین، فایل صورت‌حساب را ارسال کنید</p>
          )}
        </section>
      )}

      <footer className="statement-footer" data-export-footer>
        <span>{meta.preview ? "پیش‌نمایش — هنوز صادر نشده" : `کد اعتبارسنجی: ${meta.verificationCode}`}</span>
        <span>صادرشده توسط TabPals</span>
        <span>نسخه {toPersianDigits(meta.appVersion)}</span>
      </footer>
    </article>
  );
}
