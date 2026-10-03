import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { statementsRepository } from "@/data/repositories";
import type { StatementLinkData } from "@/domain/statementLink";
import { EmptyState } from "@/ui/components/EmptyState";
import { StatementPaper } from "../statements/StatementPaper";
import "../statements/StatementView.css";

type Preview = StatementLinkData & { appVersion: string };

/** «صورت‌حساب من»: this member's statement, computed live from the local copy of the event. Never issued, never stored. */
export function MyStatementPreviewScreen() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const link = useLiveQuery(async () => (await db.onlineLinks.get(eventId)) ?? null, [eventId]);
  // Re-render on any change of this event's data so the preview stays live.
  const stamp = useLiveQuery(async () => {
    const vouchers = await db.vouchers.where("eventId").equals(eventId).toArray();
    return vouchers.map((v) => `${v.id}:${v.version}`).join(",");
  }, [eventId]);
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);

  const memberId = link?.memberId;
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    statementsRepository
      .previewForMember(eventId, memberId)
      .then((data) => !cancelled && setPreview(data as unknown as Preview))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [eventId, memberId, stamp]);

  if (link === undefined) return <div className="screen" />;
  if (link === null || preview === null) {
    return (
      <div className="screen">
        <EmptyState hint="صورت‌حساب شما قابل نمایش نیست." />
      </div>
    );
  }
  if (!preview) return <div className="screen" />;

  return (
    <div className="screen statement-view">
      <div className="statement-view__toolbar no-print">
        <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}?tab=statements`)}>
          ← بازگشت
        </button>
      </div>
      <p className="field__hint no-print">این پیش‌نمایش زنده است و با هر تغییر ایونت به‌روز می‌شود؛ صورت‌حساب رسمی را مسئول صندوق پس از پایان ایونت صادر می‌کند.</p>
      <StatementPaper
        data={preview}
        meta={{ number: 0, issueVersion: 0, issuedAt: new Date().toISOString(), verificationCode: "", status: "current", appVersion: preview.appVersion, preview: true }}
      />
    </div>
  );
}
