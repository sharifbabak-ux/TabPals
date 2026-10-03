import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "@/data/db";
import { orderSessionsRepository } from "@/data/repositories";
import type { OrderSessionStatus } from "@/data/types";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { computePersonSubtotals } from "@/domain/groupOrder";
import { isEventClosed } from "@/domain/eventStatus";
import { isTerminalStatus } from "@/domain/orderSessionState";
import { Avatar } from "@/ui/components/Avatar";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { useOnlineEvent } from "@/ui/hooks/useOnlineEvent";
import { MenuEditorSheet } from "./MenuEditorSheet";
import { MenuPhotoViewer } from "./MenuPhotoViewer";
import { PersonOrderSheet } from "./PersonOrderSheet";
import { SessionFormSheet } from "./SessionFormSheet";
import { SessionStatusChip } from "./SessionStatusChip";
import { SharedItemSheet } from "./SharedItemSheet";
import { WaiterListSheet } from "./WaiterListSheet";
import { useBlobUrl } from "./useBlobUrl";
import { useOrderSession } from "./useOrderSession";
import "./orders.css";

/** One group-order session: header, menu photo/quick menu, the ordering grid, status actions, waiter list (docs/PLAN.md Group Order UI #4–#7). */
export function OrderSessionScreen() {
  const { eventId = "", sessionId = "" } = useParams();
  const navigate = useNavigate();

  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);
  const members = useEventMembers(eventId);
  const data = useOrderSession(sessionId);
  const online = useOnlineEvent(eventId);

  const [personId, setPersonId] = useState<string | null>(null);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [editingSharedLineId, setEditingSharedLineId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoUrl = useBlobUrl(data?.session.menuPhoto);

  const subtotals = useMemo(() => (data ? computePersonSubtotals(data.lines, data.totals) : []), [data]);
  const voucher = useLiveQuery(async () => (data?.session.voucherId ? db.vouchers.get(data.session.voucherId) : undefined), [data?.session.voucherId]);

  if (event === undefined || members === undefined || data === undefined) return <div className="screen" />;
  if (event === null || data === null) {
    return (
      <div className="screen">
        <EmptyState hint="این نشست پیدا نشد." />
      </div>
    );
  }

  const { session } = data;
  const closed = isEventClosed(event, new Date());
  // Members of an online event are read-only: same gating as a closed event, different note.
  const locked = closed || online.readOnly;
  const terminal = isTerminalStatus(session.status);
  const canManage = !locked && !terminal;
  const canEditLines = !locked && (session.status === "open" || session.status === "locked" || session.status === "pricing");
  const nameOf = (id: string) => members.find((m) => m.personId === id)?.name ?? "؟";
  const sharedLines = data.lines.filter((l) => l.personId === null);
  const editingSharedLine = sharedLines.find((l) => l.id === editingSharedLineId);
  const activePerson = members.find((m) => m.personId === personId) ?? null;

  async function transition(to: OrderSessionStatus, reason?: string) {
    setError(null);
    try {
      await orderSessionsRepository.transition(session.id, to, reason);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
      return false;
    }
  }

  async function startPricing() {
    if (await transition("pricing")) navigate(`/events/${eventId}/orders/${session.id}/pricing`);
  }

  async function confirmCancel() {
    setCancelConfirmOpen(false);
    if (await transition("cancelled", cancelReason)) {
      setCancelOpen(false);
      setCancelReason("");
    }
  }

  return (
    <div className="screen order-session">
      <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}?tab=orders`)}>
        ← بازگشت به سفارش‌ها
      </button>

      <div className="screen-header">
        <h1>
          {session.title}
          {session.restaurant ? ` · ${session.restaurant}` : ""}
        </h1>
        {canManage && (
          <button type="button" className="icon-button icon-button--ghost icon-button--label" onClick={() => setEditOpen(true)}>
            ویرایش
          </button>
        )}
      </div>
      <div className="order-session__meta">
        <SessionStatusChip status={session.status} />
        <span>
          <JalaliDate date={new Date(session.scheduledAt)} weekday time />
        </span>
        <span>مدیر نشست: {nameOf(session.adminPersonId)}</span>
      </div>

      {closed && <p className="field__hint">این ایونت پایان‌یافته است؛ نشست فقط‌خواندنی است.</p>}
      {!closed && online.readOnly && <p className="field__hint">شما در این ایونت آنلاین عضو هستید؛ نشست فقط‌خواندنی است.</p>}
      {session.status === "cancelled" && <p className="field__warning">این نشست لغو شده است{session.cancelReason ? `: ${session.cancelReason}` : "."}</p>}
      {session.status === "finalized" && (
        <p className="field__hint">
          این نشست نهایی شده است.{" "}
          {voucher && (
            <button type="button" className="list-item__action" onClick={() => navigate(`/events/${eventId}?tab=vouchers&voucher=${voucher.id}`)}>
              مشاهده‌ی سند شماره {toPersianDigits(voucher.number)}
            </button>
          )}
        </p>
      )}

      <div className="action-grid">
        {photoUrl && (
          <button type="button" className="order-session__photo-button" onClick={() => setPhotoOpen(true)}>
            <img src={photoUrl} alt="" />
            <span>عکس منو</span>
          </button>
        )}
        <button type="button" onClick={() => setMenuOpen(true)}>
          منوی سریع ({toPersianDigits(data.menuItems.length)})
        </button>
        {data.lines.length > 0 && (
          <button type="button" onClick={() => setWaiterOpen(true)}>
            فهرست گارسون
          </button>
        )}
      </div>

      {canManage && (
        <div className="order-session__actions">
          {session.status === "draft" && (
            <button type="button" className="form-actions__primary" onClick={() => transition("open")}>
              شروع ثبت سفارش
            </button>
          )}
          {session.status === "open" && (
            <button type="button" className="form-actions__primary" onClick={() => transition("locked")}>
              سفارش به گارسون داده شد
            </button>
          )}
          {session.status === "locked" && (
            <>
              <button type="button" className="form-actions__primary" onClick={startPricing}>
                قیمت‌گذاری و فاکتور
              </button>
              <button type="button" className="form-actions__secondary" onClick={() => transition("open")}>
                بازگشایی ثبت
              </button>
            </>
          )}
          {session.status === "pricing" && (
            <button type="button" className="form-actions__primary" onClick={() => navigate(`/events/${eventId}/orders/${session.id}/pricing`)}>
              ادامه‌ی قیمت‌گذاری و فاکتور
            </button>
          )}
          <button type="button" className="sheet__archive-button sheet__archive-button--danger" onClick={() => setCancelOpen(true)}>
            لغو نشست
          </button>
        </div>
      )}
      {session.status === "finalized" && (
        <div className="order-session__actions">
          <button type="button" className="form-actions__secondary" onClick={() => navigate(`/events/${eventId}/orders/${session.id}/pricing`)}>
            مشاهده‌ی قیمت‌گذاری و فاکتور
          </button>
        </div>
      )}
      {error && <p className="field__error">{error}</p>}

      {session.status !== "draft" && session.status !== "cancelled" && (
        <>
          <h2 className="section-title">ثبت سفارش</h2>
          {session.status === "open" && <p className="field__hint">روی نام هر نفر بزنید و سفارشش را ثبت کنید.</p>}
          <div className="order-grid">
            {members
              .filter((m) => m.active || subtotals.some((s) => s.personId === m.personId))
              .map((member) => {
                const subtotal = subtotals.find((s) => s.personId === member.personId);
                const hasLines = Boolean(subtotal?.hasLines);
                return (
                  <button key={member.personId} type="button" className={`order-tile${hasLines ? " order-tile--done" : ""}`} onClick={() => setPersonId(member.personId)}>
                    <Avatar id={member.personId} name={member.name} photo={member.photo} size={44} />
                    <span className="order-tile__name">{member.name}</span>
                    <span className="order-tile__status">
                      {hasLines ? (
                        <>
                          <span className="order-tile__check">✓</span>{" "}
                          {subtotal && subtotal.computable && subtotal.subtotal > 0
                            ? formatAmount(subtotal.subtotal)
                            : `${toPersianDigits(data.lines.filter((l) => l.personId === member.personId).length)} قلم`}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </button>
                );
              })}
          </div>

          <h3 className="section-title">اقلام مشترک</h3>
          {sharedLines.length === 0 && <p className="field__hint">قلم مشترکی ثبت نشده است.</p>}
          <ul className="list">
            {sharedLines.map((line) => (
              <li key={line.id} className="list-item" onClick={() => canEditLines && setEditingSharedLineId(line.id)}>
                <div className="list-item__main">
                  <span className="list-item__title">
                    {toPersianDigits(line.quantity)} × {line.itemName}
                  </span>
                  <span className="list-item__subtitle">{(line.sharedParticipants ?? []).map((p) => nameOf(p.personId)).join("، ")}</span>
                </div>
                {canEditLines && (
                  <button
                    type="button"
                    className="list-item__action"
                    onClick={(e) => {
                      e.stopPropagation();
                      void orderSessionsRepository.removeLine(line.id).catch((err) => setError(err instanceof Error ? err.message : "خطایی رخ داد"));
                    }}
                  >
                    حذف
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEditLines && (
            <div className="form-actions">
              <button type="button" className="form-actions__secondary" onClick={() => setSharedOpen(true)}>
                + قلم مشترک
              </button>
            </div>
          )}
        </>
      )}

      <PersonOrderSheet
        open={activePerson !== null}
        person={activePerson}
        data={data}
        currency={event.currency}
        editable={canEditLines}
        onClose={() => setPersonId(null)}
      />
      <SharedItemSheet
        open={sharedOpen || Boolean(editingSharedLine)}
        sessionId={session.id}
        members={members.filter((m) => m.active)}
        line={editingSharedLine}
        onClose={() => {
          setSharedOpen(false);
          setEditingSharedLineId(null);
        }}
      />
      <MenuEditorSheet open={menuOpen} sessionId={session.id} items={data.menuItems} currency={event.currency} readOnly={!canManage} onClose={() => setMenuOpen(false)} />
      <WaiterListSheet open={waiterOpen} data={data} onClose={() => setWaiterOpen(false)} />
      {photoOpen && <MenuPhotoViewer photo={session.menuPhoto ?? null} onClose={() => setPhotoOpen(false)} />}
      <SessionFormSheet
        open={editOpen}
        eventId={eventId}
        session={session}
        treasurerPersonId={event.treasurerPersonId}
        treasurerName={null}
        onClose={() => setEditOpen(false)}
        onSaved={() => setEditOpen(false)}
      />

      <BottomSheet open={cancelOpen} title="لغو نشست" onClose={() => setCancelOpen(false)}>
        <div className="field">
          <label htmlFor="cancel-reason">دلیل لغو</label>
          <textarea id="cancel-reason" className="reason-textarea" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
        </div>
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setCancelOpen(false)}>
            انصراف
          </button>
          <button type="button" className="form-actions__primary" disabled={!cancelReason.trim()} onClick={() => setCancelConfirmOpen(true)}>
            لغو نشست
          </button>
        </div>
      </BottomSheet>
      <ConfirmDialog
        open={cancelConfirmOpen}
        title="لغو نشست"
        message="نشست لغو شود؟ پس از لغو، سفارش‌ها دیگر قابل تغییر نیستند و سندی ثبت نمی‌شود."
        confirmLabel="بله، لغو شود"
        danger
        onConfirm={confirmCancel}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </div>
  );
}
