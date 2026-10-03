import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { AuditEntry, ServerDevice, ServerMember } from "@/data/online/apiClient";
import { onlineService } from "@/data/online/onlineService";
import type { OnlineRole } from "@/data/types";
import { auditActionLabel } from "@/domain/onlineErrors";
import { ONLINE_ROLES, ROLE_LABELS_FA } from "@/domain/onlinePermissions";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { useOnlineEvent } from "@/ui/hooks/useOnlineEvent";
import "./online.css";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteStatus = "pending" | "used" | "expired" | "revoked";
interface InviteRow {
  inviteId: string | number;
  memberId: string | null;
  at: string;
  status: InviteStatus;
}

const INVITE_STATUS_LABELS: Record<InviteStatus, string> = { pending: "در انتظار", used: "استفاده‌شده", expired: "منقضی", revoked: "لغوشده" };

/** The invite list is derived from the audit log (the API has no list-invites endpoint; the log carries `inviteId` for created/redeemed/revoked). */
export function deriveInvites(entries: AuditEntry[], now = Date.now()): InviteRow[] {
  const idOf = (e: AuditEntry) => (e.details && typeof e.details === "object" ? (e.details as { inviteId?: string | number }).inviteId : undefined);
  const redeemed = new Set(entries.filter((e) => e.action === "invite.redeemed").map((e) => String(idOf(e))));
  const revoked = new Set(entries.filter((e) => e.action === "invite.revoked").map((e) => String(idOf(e))));
  return entries
    .filter((e) => e.action === "invite.created" && idOf(e) !== undefined)
    .map((e) => {
      const key = String(idOf(e));
      let status: InviteStatus = "pending";
      if (redeemed.has(key)) status = "used";
      else if (revoked.has(key)) status = "revoked";
      else if (new Date(e.at).getTime() + INVITE_TTL_MS <= now) status = "expired";
      return { inviteId: idOf(e)!, memberId: e.target, at: e.at, status };
    });
}

/** «اعضا و دسترسی‌ها» — admin only: roles, devices, invites, audit log and the danger zone (docs/PLAN.md "Admin screen"). */
export function AccessScreen() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const online = useOnlineEvent(eventId);
  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);

  const [members, setMembers] = useState<ServerMember[]>([]);
  const [devices, setDevices] = useState<ServerDevice[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ServerDevice | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [purgeBusy, setPurgeBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [m, d, a] = await Promise.all([onlineService.listMembers(eventId), onlineService.listDevices(eventId), onlineService.listAudit(eventId)]);
      setMembers(m);
      setDevices(d);
      setAudit(a.entries);
      setNextBefore(a.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات");
    }
  }, [eventId]);

  useEffect(() => {
    if (online.isAdmin) void refresh();
  }, [online.isAdmin, refresh]);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.memberId, m.displayName]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [members]);
  const invites = useMemo(() => deriveInvites(audit), [audit]);

  if (!online.loaded || event === undefined) return <div className="screen" />;
  if (!online.online || !online.isAdmin || !event) {
    return (
      <div className="screen">
        <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}`)}>
          ← بازگشت
        </button>
        <EmptyState hint="این بخش فقط برای مدیر ایونت آنلاین در دسترس است." />
      </div>
    );
  }

  async function toggleRole(member: ServerMember, role: OnlineRole) {
    const next = member.roles.includes(role) ? member.roles.filter((r) => r !== role) : [...member.roles, role];
    if (next.length === 0) {
      setError("هر عضو باید دست‌کم یک نقش داشته باشد.");
      return;
    }
    setBusyRole(`${member.memberId}:${role}`);
    setError(null);
    try {
      await onlineService.setRoles(eventId, member.memberId, ONLINE_ROLES.filter((r) => next.includes(r)));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تغییر نقش ناموفق بود");
    } finally {
      setBusyRole(null);
    }
  }

  async function loadMoreAudit() {
    if (nextBefore === null) return;
    try {
      const page = await onlineService.listAudit(eventId, nextBefore);
      setAudit((prev) => [...prev, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    }
  }

  async function confirmRevokeDevice() {
    if (!revokeTarget) return;
    try {
      await onlineService.revokeDevice(eventId, revokeTarget.deviceId);
      setRevokeTarget(null);
      await refresh();
    } catch (e) {
      setRevokeTarget(null);
      setError(e instanceof Error ? e.message : "قطع دسترسی ناموفق بود");
    }
  }

  async function revokeInvite(inviteId: string | number) {
    try {
      await onlineService.revokeInvite(eventId, inviteId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "لغو دعوت ناموفق بود");
    }
  }

  async function purge() {
    setPurgeBusy(true);
    setError(null);
    try {
      await onlineService.purgeFromServer(eventId, typedTitle);
      navigate(`/events/${eventId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "حذف از سرور ناموفق بود");
      setPurgeBusy(false);
    }
  }

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}`)}>
        ← بازگشت به ایونت
      </button>
      <h1>اعضا و دسترسی‌ها</h1>
      {error && <p className="field__error">{error}</p>}

      <h2 className="section-title">نقش‌ها</h2>
      <div className="online-card">
        <ul className="online-list">
          {members.map((member) => (
            <li key={member.memberId} className="online-list__row">
              <span>{member.displayName}</span>
              <div className="role-chips">
                {ONLINE_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={`role-chip${member.roles.includes(role) ? " role-chip--on" : ""}`}
                    aria-pressed={member.roles.includes(role)}
                    disabled={busyRole === `${member.memberId}:${role}`}
                    onClick={() => toggleRole(member, role)}
                  >
                    {ROLE_LABELS_FA[role]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <h2 className="section-title">دستگاه‌ها</h2>
      <div className="online-card">
        {devices.length === 0 && <p className="field__hint">دستگاهی ثبت نشده است.</p>}
        <ul className="online-list">
          {devices.map((device) => (
            <li key={device.deviceId} className="online-list__row">
              <span>
                {nameOf(device.memberId)} · {device.label}
                {device.current && <span className="badge"> این دستگاه</span>}
                {device.revokedAt && <span className="badge"> قطع‌شده</span>}
                <br />
                <small className="field__hint">
                  آخرین فعالیت: {device.lastSeenAt ? <JalaliDate date={new Date(device.lastSeenAt)} weekday time /> : "—"}
                </small>
              </span>
              {!device.revokedAt && !device.current && (
                <button type="button" className="danger-button" onClick={() => setRevokeTarget(device)}>
                  قطع دسترسی
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <h2 className="section-title">دعوت‌نامه‌ها</h2>
      <div className="online-card">
        {invites.length === 0 && <p className="field__hint">دعوت‌نامه‌ای ساخته نشده است.</p>}
        <ul className="online-list">
          {invites.map((invite) => (
            <li key={String(invite.inviteId)} className="online-list__row">
              <span>
                {nameOf(invite.memberId)} · {INVITE_STATUS_LABELS[invite.status]}
                <br />
                <small className="field__hint">
                  <JalaliDate date={new Date(invite.at)} weekday time />
                </small>
              </span>
              {invite.status === "pending" && (
                <button type="button" className="danger-button" onClick={() => revokeInvite(invite.inviteId)}>
                  لغو دعوت
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <h2 className="section-title">گزارش رویدادها</h2>
      <div className="online-card">
        {audit.length === 0 && <p className="field__hint">موردی ثبت نشده است.</p>}
        <ul className="online-list">
          {audit.map((entry) => (
            <li key={String(entry.id)} className="online-list__row">
              <span>
                {auditActionLabel(entry.action)}
                {entry.target && entry.action !== "event.created" ? ` — ${nameOf(entry.target)}` : ""}
                <br />
                <small className="field__hint">توسط {nameOf(entry.actorMember)}</small>
              </span>
              <small className="field__hint">
                <JalaliDate date={new Date(entry.at)} weekday time />
              </small>
            </li>
          ))}
        </ul>
        {nextBefore !== null && (
          <button type="button" className="form-actions__secondary" onClick={loadMoreAudit}>
            موارد قدیمی‌تر
          </button>
        )}
      </div>

      <div className="danger-zone">
        <h3>منطقه‌ی خطر</h3>
        <p className="field__hint">با حذف ایونت از سرور، دسترسی همه‌ی اعضا قطع می‌شود و نسخه‌ی آن‌ها از دستگاهشان پاک می‌شود. نسخه‌ی روی این دستگاه به‌صورت آفلاین می‌ماند.</p>
        <button type="button" className="danger-button" onClick={() => setPurgeOpen(true)}>
          حذف ایونت از سرور
        </button>
        {purgeOpen && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="purge-title">برای تأیید، عنوان ایونت را عیناً بنویسید: «{event.title}»</label>
            <input id="purge-title" value={typedTitle} onChange={(e) => setTypedTitle(e.target.value)} autoComplete="off" />
            <button type="button" className="danger-button" disabled={purgeBusy || typedTitle.trim() !== event.title.trim()} onClick={purge} style={{ marginTop: 8 }}>
              {purgeBusy ? "در حال حذف…" : "حذف از سرور"}
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="قطع دسترسی دستگاه"
        message={`دسترسی «${revokeTarget ? nameOf(revokeTarget.memberId) : ""} · ${revokeTarget?.label ?? ""}» قطع شود؟ نسخه‌ی ایونت از آن دستگاه پاک می‌شود.`}
        confirmLabel="قطع دسترسی"
        danger
        onConfirm={confirmRevokeDevice}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
