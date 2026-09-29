import type { ComprehensiveReportData } from "@/domain/statementBuilder";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { SPLIT_MODE_LABELS, VOUCHER_TYPE_LABELS } from "./statementViewLabels";
import "./StatementView.css";

interface ComprehensiveReportViewProps {
  data: ComprehensiveReportData;
}

/** Renders the whole-event comprehensive report (docs/PLAN.md Stage 3B "COMPREHENSIVE REPORT CONTENT"). */
export function ComprehensiveReportView({ data }: ComprehensiveReportViewProps) {
  const { event, members, ledger, fundAccount, memberSummaries, hubSettlement, controlChecks } = data;

  return (
    <div className="statement-body">
      <section>
        <h2 className="section-title">اعضا</h2>
        <table className="statement-table">
          <thead>
            <tr>
              <th>نام</th>
              <th>ضریب پیش‌فرض</th>
              <th>نقش</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.personId}>
                <td>{member.name}</td>
                <td>{toPersianDigits(member.defaultWeight)}</td>
                <td>{member.isTreasurer && <span className="badge badge--treasurer">مسئول صندوق</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="section-title">دفتر کل اسناد</h2>
        <table className="statement-table">
          <thead>
            <tr>
              <th>شماره</th>
              <th>نوع</th>
              <th>تاریخ هزینه</th>
              <th>تاریخ ثبت</th>
              <th>شرح</th>
              <th>مبلغ</th>
              <th>پرداخت‌کنندگان</th>
              <th>نحوه تقسیم</th>
              <th>سهم هر نفر</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => (
              <tr key={row.number}>
                <td>{toPersianDigits(row.number)}</td>
                <td>{VOUCHER_TYPE_LABELS[row.type]}</td>
                <td>
                  <JalaliDate date={new Date(`${row.expenseDate}T00:00:00`)} />
                </td>
                <td>
                  <JalaliDate date={new Date(row.recordedAt)} />
                </td>
                <td>{row.description || "—"}</td>
                <td>
                  {formatAmount(row.totalAmount)} {event.currency}
                </td>
                <td>
                  {row.type === "expense"
                    ? row.payers.map((p) => `${p.name} (${formatAmount(p.amount)})`).join("، ") || "—"
                    : `${row.fromName ?? "—"} ← ${row.toName ?? "—"}`}
                </td>
                <td>{row.splitMode ? SPLIT_MODE_LABELS[row.splitMode] : "—"}</td>
                <td>
                  {row.type === "expense"
                    ? row.participantShares.map((s) => `${s.name}: ${formatAmount(s.share)}`).join("، ") || "—"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="section-title">حساب صندوق</h2>
        <table className="statement-table">
          <thead>
            <tr>
              <th>واریزکننده</th>
              <th>تاریخ</th>
              <th>مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {fundAccount.contributions.map((c) => (
              <tr key={c.voucherNumber}>
                <td>{c.name}</td>
                <td>
                  <JalaliDate date={new Date(`${c.date}T00:00:00`)} />
                </td>
                <td>
                  {formatAmount(c.amount)} {event.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          جمع واریزی به صندوق: {formatAmount(fundAccount.totalContributed)} {event.currency}
        </p>
        <p>
          جمع هزینه‌های پرداخت‌شده توسط مسئول صندوق: {formatAmount(fundAccount.totalPaidByTreasurer)} {event.currency}
        </p>
        <p>
          <strong>
            باقیمانده‌ی صندوق: {formatAmount(fundAccount.remaining)} {event.currency}
          </strong>
        </p>
      </section>

      <section>
        <h2 className="section-title">خلاصه هر عضو</h2>
        <table className="statement-table">
          <thead>
            <tr>
              <th>نام</th>
              <th>پرداختی</th>
              <th>سهم</th>
              <th>واریز به صندوق</th>
              <th>دریافتی صندوق</th>
              <th>تسویه پرداختی</th>
              <th>تسویه دریافتی</th>
              <th>مانده</th>
            </tr>
          </thead>
          <tbody>
            {memberSummaries.map((row) => (
              <tr key={row.personId}>
                <td>{row.name}</td>
                <td>{formatAmount(row.expensePaid)}</td>
                <td>{formatAmount(row.expenseShare)}</td>
                <td>{formatAmount(row.contributedToFund)}</td>
                <td>{formatAmount(row.receivedAsTreasurer)}</td>
                <td>{formatAmount(row.settlementsPaid)}</td>
                <td>{formatAmount(row.settlementsReceived)}</td>
                <td>
                  {formatAmount(row.balance)} {event.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {hubSettlement && (
        <section>
          <h2 className="section-title">برنامه‌ی تسویه‌ی صندوق</h2>
          {hubSettlement.paysToTreasurer.length > 0 && (
            <>
              <h3>دریافت از اعضا</h3>
              <ul className="statement-hub-list">
                {hubSettlement.paysToTreasurer.map((row) => (
                  <li key={row.personId}>
                    {row.name}: {formatAmount(row.amount)} {event.currency}
                  </li>
                ))}
              </ul>
            </>
          )}
          {hubSettlement.paysFromTreasurer.length > 0 && (
            <>
              <h3>پرداخت به اعضا</h3>
              <ul className="statement-hub-list">
                {hubSettlement.paysFromTreasurer.map((row) => (
                  <li key={row.personId}>
                    {row.name}: {formatAmount(row.amount)} {event.currency}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title">کنترل‌های محاسباتی</h2>
        <ul className="statement-control-checks">
          {controlChecks.map((check) => (
            <li key={check.label} className={check.passed ? "statement-control-checks__pass" : "statement-control-checks__fail"}>
              {check.label} {check.passed ? "✓" : "✗"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
