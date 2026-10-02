import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { SendChannel } from "@/data/types";
import { statementsRepository } from "@/data/repositories";
import { computeVerificationCode } from "@/domain/verificationCode";
import type { StatementLinkData } from "@/domain/statementLink";
import { EmptyState } from "@/ui/components/EmptyState";
import { StatementPaper } from "./statements/StatementPaper";
import { SendMenuSheet } from "./statements/SendMenuSheet";
import "./statements/StatementView.css";

type ParsedSnapshot = StatementLinkData & { appVersion: string };

export function StatementViewScreen() {
  const { eventId = "", statementId = "" } = useParams();
  const navigate = useNavigate();
  const [verifyResult, setVerifyResult] = useState<"ok" | "mismatch" | null>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);

  const statement = useLiveQuery(() => db.statements.get(statementId), [statementId]);
  const memberPersonId = statement?.personId ?? null;
  const memberPerson = useLiveQuery(() => (memberPersonId ? db.persons.get(memberPersonId) : undefined), [memberPersonId]);

  async function handleVerify() {
    if (!statement) return;
    const recomputed = await computeVerificationCode(statement.snapshot);
    setVerifyResult(recomputed === statement.verificationCode ? "ok" : "mismatch");
  }

  async function handlePrint() {
    window.print();
    if (statement) await statementsRepository.logSend(statement.id, "print", statement.personId ?? "event");
  }

  async function handleSent(channel: SendChannel, target: string) {
    if (!statement) return;
    await statementsRepository.logSend(statement.id, channel, target);
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
        <div className="statement-view__toolbar-actions">
          <button type="button" onClick={() => setSendMenuOpen(true)}>
            ارسال
          </button>
          <button type="button" onClick={handlePrint}>
            چاپ / ذخیره PDF
          </button>
        </div>
      </div>

      {statement.status === "outdated" && (
        <p className="field__warning no-print">این صورت‌حساب منسوخ شده است؛ ایونت پس از صدور آن بازگشایی شده است.</p>
      )}

      <StatementPaper
        data={data}
        meta={{
          number: statement.number,
          issueVersion: statement.issueVersion,
          issuedAt: statement.issuedAt,
          verificationCode: statement.verificationCode,
          status: statement.status,
          appVersion: data.appVersion
        }}
      />

      <p className="field__hint no-print statement-view__verify">
        <button type="button" className="list-item__action" onClick={handleVerify}>
          بررسی اعتبار
        </button>
        {verifyResult === "ok" && <span className="statement-footer__verify statement-footer__verify--ok"> ✓ معتبر</span>}
        {verifyResult === "mismatch" && <span className="statement-footer__verify statement-footer__verify--bad"> ✗ عدم تطابق</span>}
      </p>

      <SendMenuSheet
        open={sendMenuOpen}
        onClose={() => setSendMenuOpen(false)}
        statement={statement}
        data={data}
        eventTitle={data.event.title}
        phone={memberPerson?.phone}
        onSent={handleSent}
      />
    </div>
  );
}
