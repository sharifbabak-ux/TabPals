import { formatAmount, toPersianDigits } from "@/domain/format";
import type { GroupStatementData } from "@/domain/groupStatement";
import { buildBalanceText } from "@/domain/messageTemplate";
import { MaskedValue } from "@/ui/components/MaskedValue";
import { GROUP_STATEMENT_TEXT as T } from "./statementViewLabels";
import "./StatementView.css";
import "./groupStatement.css";

interface GroupStatementViewProps {
  data: GroupStatementData;
  /** On-screen only: card numbers and IBANs show masked until tapped. Exports render them in full (or not at all, per the privacy setting). */
  maskPayment?: boolean;
}

/** One member's own balance, worded like the individual statements. */
function memberBalanceText(balance: number, currency: string): string {
  return balance === 0 ? T.settledLine : buildBalanceText(balance, currency);
}

function toneClass(balance: number): string {
  return balance > 0 ? "group-statement__amount--creditor" : balance < 0 ? "group-statement__amount--debtor" : "";
}

/** The group statement's body (docs/PLAN.md, SG-5): same look and payment block as the individual statements. */
export function GroupStatementView({ data, maskPayment = false }: GroupStatementViewProps) {
  const { event, group, members } = data;
  const showPayment = data.outcome === "pay" && !data.treasurerInGroup && (data.treasurerName || data.treasurerCardNumberGrouped || data.treasurerIbanGrouped);

  return (
    <div className="statement-body">
      <section data-export-block>
        <p className="group-statement__line">
          <strong>
            {T.groupWord} {group.name}
          </strong>
        </p>
        <p className="group-statement__line">
          {T.representative}: <strong>{group.representativeName}</strong>
        </p>
        <p className="group-statement__line group-statement__line--muted">
          {T.membersLine} ({toPersianDigits(members.length)} نفر): {members.map((m) => m.name).join("، ")}
        </p>
      </section>

      <section data-export-block>
        <h2 className="section-title">{T.membersTitle}</h2>
        <div className="table-scroll">
          <table className="statement-table">
            <thead>
              <tr>
                <th>{T.colMember}</th>
                <th>{T.colBalance}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.personId}>
                  <td>
                    {m.name}
                    {!m.active && <span className="group-statement__note"> {T.archivedNote}</span>}
                  </td>
                  <td className={toneClass(m.balance)}>{memberBalanceText(m.balance, event.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{T.internalCancelled}</td>
                <td>{data.internalCancelled > 0 ? `${formatAmount(data.internalCancelled)} ${event.currency}` : T.noInternal}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section data-export-block>
        <h2 className="section-title">{T.totalTitle}</h2>
        <div className="table-scroll">
          <table className="statement-table statement-table--summary">
            <tbody>
              <tr className="statement-table__balance-row">
                <td>{T.groupBalance}</td>
                <td className={toneClass(data.groupBalance)}>{data.outcome === "settled" ? T.settledChip : buildBalanceText(data.groupBalance, event.currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="statement-closing-box" data-export-block>
        <p>{data.closingText}</p>
      </section>

      {showPayment && (
        <section className="statement-payment-box" data-export-block>
          <h2 className="section-title">{T.paymentTitle}</h2>
          {data.treasurerName && (
            <p>
              {T.treasurerLabel}: <strong>{data.treasurerName}</strong>
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
          {data.treasurerAccountHolder && (
            <p data-payment-detail>
              {T.holderPrefix} {data.treasurerAccountHolder}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
