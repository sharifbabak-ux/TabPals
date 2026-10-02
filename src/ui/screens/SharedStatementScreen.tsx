import { useParams } from "react-router-dom";
import { decodeStatementPayload } from "@/domain/statementLink";
import { EmptyState } from "@/ui/components/EmptyState";
import { StatementPaper } from "./statements/StatementPaper";
import "./statements/StatementView.css";

/**
 * Renders the no-server statement link route `#/s/<payload>` (docs/PLAN.md
 * Stage 3C). The payload carries everything needed to render — this screen
 * NEVER reads the local database, so it works identically for whoever
 * opens the link, on any device, with no data of their own.
 */
export function SharedStatementScreen() {
  const { payload = "" } = useParams();
  const decoded = decodeStatementPayload(payload);

  if (!decoded) {
    return (
      <div className="screen">
        <EmptyState hint="این لینک صورت‌حساب معتبر نیست یا خراب شده است." />
      </div>
    );
  }

  return (
    <div className="screen statement-view">
      <p className="field__hint no-print">این صورت‌حساب از طریق لینک باز شده است — کد اعتبارسنجی: {decoded.verificationCode}</p>
      <StatementPaper data={decoded.data} meta={decoded} />
    </div>
  );
}
