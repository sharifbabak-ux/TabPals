import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { toPersianDigits } from "@/domain/format";
import { computeVerificationCode } from "@/domain/verificationCode";
import type { ComprehensiveReportData, MemberStatementData } from "@/domain/statementBuilder";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Logo } from "@/ui/components/Logo";
import { Avatar } from "@/ui/components/Avatar";
import { MemberStatementView } from "./statements/MemberStatementView";
import { ComprehensiveReportView } from "./statements/ComprehensiveReportView";
import "./statements/StatementView.css";

type ParsedSnapshot = ((MemberStatementData & { closingText: string }) | ComprehensiveReportData) & { appVersion: string };

export function StatementViewScreen() {
  const { eventId = "", statementId = "" } = useParams();
  const navigate = useNavigate();
  const [verifyResult, setVerifyResult] = useState<"ok" | "mismatch" | null>(null);

  const statement = useLiveQuery(() => db.statements.get(statementId), [statementId]);

  async function handleVerify() {
    if (!statement) return;
    const recomputed = await computeVerificationCode(statement.snapshot);
    setVerifyResult(recomputed === statement.verificationCode ? "ok" : "mismatch");
  }

  if (statement === undefined) return <div className="screen" />;

  if (statement === null) {
    return (
      <div className="screen">
        <EmptyState hint="این صورت‌حساب پیدا نشد." />
      </div>
    );
  }

  const data = JSON.parse(statement.snapshot) as ParsedSnapshot;

  return (
    <div className="screen statement-view">
      <div className="statement-view__toolbar no-print">
        <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}`)}>
          ← بازگشت
        </button>
        <button type="button" onClick={() => window.print()}>
          چاپ / PDF
        </button>
      </div>

      {statement.status === "outdated" && (
        <p className="field__warning no-print">این صورت‌حساب منسوخ شده است؛ ایونت پس از صدور آن بازگشایی شده است.</p>
      )}

      <article className="statement-paper">
        <header className="statement-header">
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
              <Avatar id={data.member.personId} name={data.member.name} size={48} />
              <span>{data.member.name}</span>
            </div>
          )}
          <div className="statement-header__meta">
            <span>شماره {toPersianDigits(statement.number)}</span>
            <span>نسخه {toPersianDigits(statement.issueVersion)}</span>
            <span>
              <JalaliDate date={new Date(statement.issuedAt)} weekday time />
            </span>
            <span className="badge badge--closed">پایان‌یافته</span>
          </div>
        </header>

        {data.kind === "comprehensive" ? <ComprehensiveReportView data={data} /> : <MemberStatementView data={data} closingText={data.closingText} />}

        <footer className="statement-footer">
          <span>کد اعتبارسنجی: {statement.verificationCode}</span>
          <span>صادرشده توسط TabPals</span>
          <span>نسخه {toPersianDigits(data.appVersion)}</span>
          <span className="no-print">
            <button type="button" className="list-item__action" onClick={handleVerify}>
              بررسی اعتبار
            </button>
            {verifyResult === "ok" && <span className="statement-footer__verify statement-footer__verify--ok"> ✓ معتبر</span>}
            {verifyResult === "mismatch" && <span className="statement-footer__verify statement-footer__verify--bad"> ✗ عدم تطابق</span>}
          </span>
        </footer>
      </article>
    </div>
  );
}
