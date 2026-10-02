import type { Ref } from "react";
import { toPersianDigits } from "@/domain/format";
import type { StatementLinkData } from "@/domain/statementLink";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Logo } from "@/ui/components/Logo";
import { Avatar } from "@/ui/components/Avatar";
import { MemberStatementView } from "./MemberStatementView";
import { ComprehensiveReportView } from "./ComprehensiveReportView";
import "./StatementView.css";

export interface StatementPaperMeta {
  number: number;
  issueVersion: number;
  issuedAt: string;
  verificationCode: string;
  status: "current" | "outdated";
  appVersion: string;
}

interface StatementPaperProps {
  data: StatementLinkData;
  meta: StatementPaperMeta;
  /** Passed straight to the root `<article>` — used both on-screen (StatementViewScreen) and for the offscreen bulk-export render. */
  innerRef?: Ref<HTMLElement>;
}

/**
 * The statement/report "paper": shared between the DB-backed statement
 * view, the no-server shared-link view, and the offscreen render used for
 * bulk export (docs/PLAN.md Stage 3C) — one markup source so all three stay
 * visually identical and the print/export CSS only has to target one shape.
 */
export function StatementPaper({ data, meta, innerRef }: StatementPaperProps) {
  return (
    <article className="statement-paper" ref={innerRef}>
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
          <span>شماره {toPersianDigits(meta.number)}</span>
          <span>نسخه {toPersianDigits(meta.issueVersion)}</span>
          <span>
            <JalaliDate date={new Date(meta.issuedAt)} weekday time />
          </span>
          {meta.status === "outdated" ? <span className="badge">منسوخ</span> : <span className="badge badge--closed">پایان‌یافته</span>}
        </div>
      </header>

      {data.kind === "comprehensive" ? <ComprehensiveReportView data={data} /> : <MemberStatementView data={data} closingText={data.closingText} />}

      <footer className="statement-footer" data-export-block>
        <span>کد اعتبارسنجی: {meta.verificationCode}</span>
        <span>صادرشده توسط TabPals</span>
        <span>نسخه {toPersianDigits(meta.appVersion)}</span>
      </footer>
    </article>
  );
}
