import { useParams } from "react-router-dom";
import { buildBalanceText } from "@/domain/messageTemplate";
import { decodeSharedPayload, type SummaryLinkPayload } from "@/domain/statementLink";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Logo } from "@/ui/components/Logo";
import { StatementPaper } from "./statements/StatementPaper";
import "./statements/StatementView.css";

export const SUMMARY_NOTE = "این نسخه‌ی خلاصه است؛ صورت‌حساب کامل را از مسئول صندوق بگیرید";

function SummaryView({ summary }: { summary: SummaryLinkPayload }) {
  const isMember = summary.k === "m" && summary.b !== undefined;
  const balance = summary.b ?? 0;
  return (
    <article className="statement-paper statement-summary">
      <header className="statement-header">
        <Logo variant="mark" size={44} />
        <div className="statement-header__title">
          <strong>TabPals – حساب دوستانه</strong>
          <span>{summary.e}</span>
        </div>
        {summary.n && (
          <div className="statement-header__member">
            <span>{summary.n}</span>
          </div>
        )}
        <div className="statement-header__meta">
          <span>
            تاریخ صدور: <JalaliDate date={new Date(`${summary.d}T00:00:00`)} />
          </span>
        </div>
      </header>
      <div className="statement-body">
        {isMember && (
          <section className="statement-closing-box">
            <p className="statement-closing-box__balance">{buildBalanceText(balance, summary.c)}</p>
          </section>
        )}
        {(summary.r || summary.cd || summary.ib) && (
          <section className="statement-payment-box">
            <h2 className="section-title">اطلاعات پرداخت</h2>
            {summary.r && (
              <p>
                مسئول صندوق: <strong>{summary.r}</strong>
              </p>
            )}
            {summary.cd && (
              <p dir="ltr" className="statement-payment-box__number">
                {summary.cd.replace(/(\d{4})(?=\d)/g, "$1 ")}
              </p>
            )}
            {summary.ib && (
              <p dir="ltr" className="statement-payment-box__number">
                {summary.ib}
              </p>
            )}
          </section>
        )}
        <p className="statement-summary__note">{SUMMARY_NOTE}</p>
      </div>
      <footer className="statement-footer">
        <span>کد اعتبارسنجی: {summary.vc}</span>
        <span>صادرشده توسط TabPals</span>
      </footer>
    </article>
  );
}

/**
 * Renders the no-server statement link route `#/s/<payload>` (docs/PLAN.md
 * Stage 3C). The payload carries everything needed to render — this screen
 * NEVER reads the local database, so it works identically for whoever
 * opens the link, on any device, with no data of their own. A payload is
 * either the full statement or the compact "summary" tier printed in the
 * export QR (docs/PLAN.md GO-1.1).
 */
export function SharedStatementScreen() {
  const { payload = "" } = useParams();
  const decoded = decodeSharedPayload(payload);

  if (!decoded) {
    return (
      <div className="screen">
        <EmptyState hint="این لینک صورت‌حساب معتبر نیست یا خراب شده است." />
      </div>
    );
  }

  if (decoded.tier === "summary") {
    return (
      <div className="screen statement-view">
        <p className="field__hint no-print">این صورت‌حساب از طریق لینک باز شده است — کد اعتبارسنجی: {decoded.payload.vc}</p>
        <SummaryView summary={decoded.payload} />
      </div>
    );
  }

  return (
    <div className="screen statement-view">
      <p className="field__hint no-print">این صورت‌حساب از طریق لینک باز شده است — کد اعتبارسنجی: {decoded.payload.verificationCode}</p>
      <StatementPaper data={decoded.payload.data} meta={decoded.payload} />
    </div>
  );
}
