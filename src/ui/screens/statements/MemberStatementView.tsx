import { Fragment } from "react";
import type { MemberStatementData } from "@/domain/statementBuilder";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { describeFundBalance } from "@/domain/fundBalance";
import { buildBalanceText } from "@/domain/messageTemplate";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { MaskedValue } from "@/ui/components/MaskedValue";
import { FUND_ENTRY_LABELS } from "./statementViewLabels";
import "./StatementView.css";

interface MemberStatementViewProps {
  data: MemberStatementData;
  closingText: string;
  /** On-screen only: card numbers and IBANs show masked until tapped. Exports render them in full (or not at all, per the privacy setting). */
  maskPayment?: boolean;
}

/** Renders both member and treasurer statements (docs/PLAN.md Stage 3B "MEMBER STATEMENT CONTENT" / "TREASURER STATEMENT"). */
export function MemberStatementView({ data, closingText, maskPayment = false }: MemberStatementViewProps) {
  const { event, expenses, expenseTotals, fundEntries, summary, treasurerName, hubSettlement } = data;
  const balanceText = buildBalanceText(summary.balance, event.currency);
  const isDebtor = summary.balance < 0;

  return (
    <div className="statement-body">
      <section data-export-block>
        <h2 className="section-title">ریز هزینه‌ها</h2>
        {expenses.length === 0 ? (
          <p className="statement-empty">در این هزینه‌ای سهیم نبوده یا پرداختی نداشته‌اید.</p>
        ) : (
          <div className="table-scroll">
          <table className="statement-table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>تاریخ</th>
                <th>شرح</th>
                <th>مبلغ کل</th>
                <th>نحوه تقسیم</th>
                <th>سهم شما</th>
                <th>پرداختی شما</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((row) => (
                <Fragment key={row.voucherNumber}>
                  <tr>
                    <td>{toPersianDigits(row.voucherNumber)}</td>
                    <td>
                      <JalaliDate date={new Date(`${row.expenseDate}T00:00:00`)} />
                    </td>
                    <td>{row.description || "—"}</td>
                    <td>
                      {formatAmount(row.totalAmount)} {event.currency}
                    </td>
                    <td className="statement-table__explanation">{row.splitExplanation || "—"}</td>
                    <td>
                      {formatAmount(row.share)} {event.currency}
                    </td>
                    <td>
                      {formatAmount(row.paid)} {event.currency}
                    </td>
                  </tr>
                  <tr className="statement-table__note-row">
                    <td colSpan={7}>سهیم‌ها: {row.participantNames.join("، ") || "—"}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>جمع</td>
                <td>
                  {formatAmount(expenseTotals.totalAmount)} {event.currency}
                </td>
                <td />
                <td>
                  {formatAmount(expenseTotals.totalShare)} {event.currency}
                </td>
                <td>
                  {formatAmount(expenseTotals.totalPaid)} {event.currency}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        )}
      </section>

      <section data-export-block>
        <h2 className="section-title">صندوق و تسویه‌ها</h2>
        {fundEntries.length === 0 ? (
          <p className="statement-empty">واریز یا تسویه‌ای ثبت نشده است.</p>
        ) : (
          <div className="table-scroll">
          <table className="statement-table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>تاریخ</th>
                <th>شرح</th>
                <th>طرف حساب</th>
                <th>مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {fundEntries.map((entry, index) => (
                <tr key={index}>
                  <td>{FUND_ENTRY_LABELS[entry.kind]}</td>
                  <td>
                    <JalaliDate date={new Date(`${entry.date}T00:00:00`)} />
                  </td>
                  <td>{entry.description || "—"}</td>
                  <td>{entry.counterpartyName ?? "—"}</td>
                  <td>
                    {formatAmount(entry.amount)} {event.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {data.kind === "treasurer" && data.fundSummary && (
          <p className="statement-fund-line">
            <strong>{describeFundBalance(data.fundSummary.totalContributed, data.fundSummary.totalPaidByTreasurer, event.currency).text}</strong>
          </p>
        )}
      </section>

      <section data-export-block>
        <h2 className="section-title">خلاصه حساب</h2>
        <div className="table-scroll">
        <table className="statement-table statement-table--summary">
          <tbody>
            <tr>
              <td>سهم از هزینه‌ها</td>
              <td>
                {formatAmount(summary.expenseShare)} {event.currency}
              </td>
            </tr>
            <tr>
              <td>پرداخت بابت هزینه‌ها</td>
              <td>
                {formatAmount(summary.expensePaid)} {event.currency}
              </td>
            </tr>
            <tr>
              <td>واریز به صندوق</td>
              <td>
                {formatAmount(summary.contributedToFund)} {event.currency}
              </td>
            </tr>
            {data.kind === "treasurer" && (
              <tr>
                <td>دریافتی به‌عنوان مسئول صندوق</td>
                <td>
                  {formatAmount(summary.receivedAsTreasurer)} {event.currency}
                </td>
              </tr>
            )}
            <tr>
              <td>تسویه‌های پرداختی</td>
              <td>
                {formatAmount(summary.settlementsPaid)} {event.currency}
              </td>
            </tr>
            <tr>
              <td>تسویه‌های دریافتی</td>
              <td>
                {formatAmount(summary.settlementsReceived)} {event.currency}
              </td>
            </tr>
            <tr className="statement-table__balance-row">
              <td>مانده نهایی</td>
              <td>{balanceText}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      {hubSettlement && (
        <section data-export-block>
          <h2 className="section-title">وظایف تسویه‌ی صندوق</h2>
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
                    <div>
                      {row.name}: {formatAmount(row.amount)} {event.currency}
                    </div>
                    {(row.cardNumberGrouped || row.ibanGrouped || row.bankName || row.accountHolder) && (
                      <div className="statement-hub-list__bank" data-payment-detail>
                        {row.bankName && <span>{row.bankName}</span>}
                        {row.cardNumberGrouped && (maskPayment ? <MaskedValue kind="card" value={row.cardNumberGrouped} /> : <span dir="ltr">{row.cardNumberGrouped}</span>)}
                        {row.ibanGrouped && (maskPayment ? <MaskedValue kind="iban" value={row.ibanGrouped} /> : <span dir="ltr">{row.ibanGrouped}</span>)}
                        {row.accountHolder && <span>به نام {row.accountHolder}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="statement-hub-totals">
            جمع دریافتی: {formatAmount(hubSettlement.totalCollected)} {event.currency} · جمع پرداختی: {formatAmount(hubSettlement.totalPaidOut)}{" "}
            {event.currency}
          </p>
        </section>
      )}

      <section className="statement-closing-box" data-export-block>
        <p>{closingText}</p>
        <p className="statement-closing-box__balance">{balanceText}</p>
      </section>

      {isDebtor && (treasurerName || data.treasurerCardNumberGrouped || data.treasurerIbanGrouped) && (
        <section className="statement-payment-box" data-export-block>
          <h2 className="section-title">اطلاعات پرداخت</h2>
          {treasurerName && (
            <p>
              مسئول صندوق: <strong>{treasurerName}</strong>
            </p>
          )}
          {data.treasurerBankName && <p data-payment-detail>{data.treasurerBankName}</p>}
          {data.treasurerCardNumberGrouped && (
            <p dir="ltr" className="statement-payment-box__number" data-payment-detail>
              {maskPayment ? <MaskedValue kind="card" value={data.treasurerCardNumberGrouped} /> : data.treasurerCardNumberGrouped}
            </p>
          )}
          {data.treasurerIbanGrouped && (
            <p dir="ltr" className="statement-payment-box__number" data-payment-detail>
              {maskPayment ? <MaskedValue kind="iban" value={data.treasurerIbanGrouped} /> : data.treasurerIbanGrouped}
            </p>
          )}
          {data.treasurerAccountHolder && <p data-payment-detail>به نام {data.treasurerAccountHolder}</p>}
        </section>
      )}
    </div>
  );
}
