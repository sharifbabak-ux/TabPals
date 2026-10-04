import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { SendChannel } from "@/data/types";
import { statementsRepository } from "@/data/repositories";
import { computeVerificationCode } from "@/domain/verificationCode";
import { hidePaymentDetails } from "@/domain/paymentVisibility";
import { isPendingKey, PENDING_KEY_TEXT } from "@/domain/encryptedDisplay";
import { EmptyState } from "@/ui/components/EmptyState";
import { useHidePaymentInExports } from "@/ui/hooks/useHidePaymentInExports";
import { useOnlineEvent } from "@/ui/hooks/useOnlineEvent";
import { parseSnapshot, withCreditorDetails, type ParsedSnapshot } from "./statements/statementData";
import { StatementPaper, type StatementPaperMeta } from "./statements/StatementPaper";
import { buildStatementShareLink } from "./statements/sendActions";
import { SendMenuSheet } from "./statements/SendMenuSheet";
import "./statements/StatementView.css";

export function StatementViewScreen() {
  const { eventId = "", statementId = "" } = useParams();
  const navigate = useNavigate();
  const [verifyResult, setVerifyResult] = useState<"ok" | "mismatch" | null>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const online = useOnlineEvent(eventId);

  const statement = useLiveQuery(() => db.statements.get(statementId), [statementId]);
  const memberPersonId = statement?.personId ?? null;
  const memberPerson = useLiveQuery(() => (memberPersonId ? db.persons.get(memberPersonId) : undefined), [memberPersonId]);

  const [link, setLink] = useState<StatementPaperMeta["link"]>(undefined);
  const snapshot = statement?.snapshot;
  const parsed = snapshot ? parseSnapshot(snapshot) : null;
  const hidePayment = useHidePaymentInExports();
  /** On-screen data: creditors' bank details filled in from local member profiles (only present on treasurer/admin devices). */
  const [filled, setFilled] = useState<ParsedSnapshot | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const current = parseSnapshot(snapshot);
    if (!current) {
      setFilled(null);
      return;
    }
    let cancelled = false;
    withCreditorDetails(current).then((result) => {
      if (!cancelled) setFilled(result);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);
  const screenData = filled ?? parsed;
  /** What leaves the app (send menu, exports): the same data, minus payment details when the privacy setting is on. */
  const exportData = screenData && hidePayment ? hidePaymentDetails(screenData) : screenData;

  useEffect(() => {
    if (!statement || !exportData) return;
    let cancelled = false;
    buildStatementShareLink(statement, exportData, exportData.event.title).then((result) => {
      if (!cancelled) setLink(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement?.id, snapshot, statement?.status, statement?.issueVersion, hidePayment, Boolean(exportData)]);

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

  if (!screenData || !exportData) {
    // The snapshot arrived encrypted and this device has no event key yet.
    return (
      <div className="screen statement-view">
        <div className="statement-view__toolbar no-print">
          <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}`)}>
            ← بازگشت
          </button>
        </div>
        <EmptyState hint={PENDING_KEY_TEXT} />
      </div>
    );
  }
  const data = screenData;

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
        <p className="field__warning no-print">این صورت‌حساب نیازمند صدور مجدد است؛ ایونت پس از صدور آن بازگشایی شده است.</p>
      )}

      <StatementPaper
        data={data}
        maskPayment
        hidePaymentOnPrint={hidePayment}
        meta={{
          number: statement.number,
          issueVersion: statement.issueVersion,
          issuedAt: statement.issuedAt,
          verificationCode: statement.verificationCode,
          status: statement.status,
          appVersion: data.appVersion,
          link
        }}
      />

      {/* A member's copy of a synced statement has its bank details removed, so its hash cannot match the original: verification belongs to the treasurer's device. */}
      {!online.readOnly && (
        <p className="field__hint no-print statement-view__verify">
          <button type="button" className="list-item__action" onClick={handleVerify}>
            بررسی اعتبار
          </button>
          {verifyResult === "ok" && <span className="statement-footer__verify statement-footer__verify--ok"> ✓ معتبر</span>}
          {verifyResult === "mismatch" && <span className="statement-footer__verify statement-footer__verify--bad"> ✗ عدم تطابق</span>}
        </p>
      )}

      <SendMenuSheet
        open={sendMenuOpen}
        onClose={() => setSendMenuOpen(false)}
        statement={statement}
        data={exportData}
        eventTitle={data.event.title}
        phone={isPendingKey(memberPerson?.phone) ? undefined : memberPerson?.phone}
        onSent={handleSent}
      />
    </div>
  );
}
