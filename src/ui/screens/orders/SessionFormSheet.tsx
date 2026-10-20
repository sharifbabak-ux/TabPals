import { useEffect, useRef, useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import type { OrderSession, SessionMode, SessionSettlement } from "@/data/types";
import { SESSION_MODE_LABELS, SESSION_SETTLEMENT_LABELS, sessionMode, sessionParticipantIds, sessionSettlement } from "@/domain/sessionModel";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { menuPhotoService } from "@/platform";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { useBlobUrl } from "./useBlobUrl";

interface SessionFormSheetProps {
  open: boolean;
  eventId: string;
  /** Present when editing an existing session. */
  session?: OrderSession;
  treasurerPersonId: string | null;
  treasurerName: string | null;
  onClose: () => void;
  /** Called with the new session's id after creating. */
  onCreated?: (sessionId: string) => void;
  onSaved?: () => void;
  onRequestSetTreasurer?: () => void;
}

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "نشست جدید" / edit sheet: title, restaurant, Jalali date + time, optional compressed menu photo (docs/PLAN.md Group Order UI #3). */
export function SessionFormSheet({ open, eventId, session, treasurerPersonId, treasurerName, onClose, onCreated, onSaved, onRequestSetTreasurer }: SessionFormSheetProps) {
  const [title, setTitle] = useState("شام");
  const [restaurant, setRestaurant] = useState("");
  const [date, setDate] = useState(toDateInput(new Date()));
  const [time, setTime] = useState(toTimeInput(new Date()));
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [mode, setMode] = useState<SessionMode>("admin-entered");
  const [membersMayPrice, setMembersMayPrice] = useState(false);
  const [settlement, setSettlement] = useState<SessionSettlement>("event");
  const photoUrl = useBlobUrl(photo);
  const members = useEventMembers(eventId);
  const activeMembers = (members ?? []).filter((m) => m.active);

  useEffect(() => {
    if (!open) return;
    const when = session ? new Date(session.scheduledAt) : new Date();
    setTitle(session?.title ?? "شام");
    setRestaurant(session?.restaurant ?? "");
    setDate(toDateInput(when));
    setTime(toTimeInput(when));
    setPhoto(session?.menuPhoto ?? null);
    setMode(session ? sessionMode(session) : "admin-entered");
    setMembersMayPrice(session?.membersMayPrice ?? false);
    setSettlement(session ? sessionSettlement(session) : "event");
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default = everyone active; for an existing session, its stored participants.
  const participantsInitialized = useRef(false);
  useEffect(() => {
    if (!open) {
      participantsInitialized.current = false;
      return;
    }
    if (participantsInitialized.current || members === undefined) return;
    participantsInitialized.current = true;
    setParticipants(sessionParticipantIds(session ?? {}, activeMembers.map((m) => m.personId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, members]);

  function toggleParticipant(personId: string) {
    setParticipants((prev) => (prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]));
  }

  async function pickPhoto(source: "camera" | "gallery") {
    setError(null);
    try {
      const blob = await menuPhotoService.pickScaledPhoto(source);
      if (blob) setPhoto(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت تصویر");
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${date}T${time || "00:00"}:00`).toISOString();
      if (session) {
        await orderSessionsRepository.update(session.id, { title, restaurant, scheduledAt, menuPhoto: photo, participants, mode, membersMayPrice, settlement });
        onSaved?.();
      } else {
        const created = await orderSessionsRepository.create({ eventId, title, restaurant, scheduledAt, menuPhoto: photo ?? undefined, participants, mode, membersMayPrice, settlement });
        onCreated?.(created.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  const missingTreasurer = !session && !treasurerPersonId;

  return (
    <BottomSheet open={open} title={session ? "ویرایش نشست" : "نشست جدید"} onClose={onClose}>
      {missingTreasurer ? (
        <>
          <p className="field__warning">برای ثبت سفارش گروهی، ابتدا مسئول صندوق ایونت را تعیین کنید؛ او مدیر نشست است.</p>
          {onRequestSetTreasurer && (
            <div className="form-actions">
              <button type="button" className="form-actions__primary" onClick={onRequestSetTreasurer}>
                تعیین مسئول صندوق
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="session-title">عنوان</label>
            <input id="session-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="شام" />
          </div>
          <div className="field">
            <label htmlFor="session-restaurant">رستوران (اختیاری)</label>
            <input id="session-restaurant" value={restaurant} onChange={(e) => setRestaurant(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="session-date">تاریخ</label>
            <JalaliDatePicker id="session-date" value={date} onChange={setDate} />
          </div>
          <div className="field">
            <label htmlFor="session-time">ساعت</label>
            <input id="session-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div className="field">
            <label>عکس منو (اختیاری)</label>
            {photoUrl && <img className="session-form__photo" src={photoUrl} alt="منو" />}
            <div className="person-photo-field__actions">
              <button type="button" onClick={() => pickPhoto("camera")}>
                دوربین
              </button>
              <button type="button" onClick={() => pickPhoto("gallery")}>
                گالری
              </button>
              {photo && (
                <button type="button" className="person-photo-field__remove" onClick={() => setPhoto(null)}>
                  حذف
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>شرکت‌کنندگان</label>
            <div className="person-photo-field__actions">
              <button type="button" onClick={() => setParticipants(activeMembers.map((m) => m.personId))}>
                همه
              </button>
              <button type="button" onClick={() => setParticipants([])}>
                هیچ‌کس
              </button>
            </div>
            <div className="session-form__participants">
              {activeMembers.map((m) => (
                <button
                  key={m.personId}
                  type="button"
                  className={`category-chip${participants.includes(m.personId) ? " category-chip--selected" : ""}`}
                  aria-pressed={participants.includes(m.personId)}
                  onClick={() => toggleParticipant(m.personId)}
                >
                  {m.name}
                </button>
              ))}
            </div>
            {participants.length === 0 && <p className="field__warning">حداقل یک نفر را انتخاب کنید.</p>}
          </div>

          <div className="field">
            <label>شیوه‌ی ثبت سفارش</label>
            <div className="session-form__choices" role="radiogroup">
              {(Object.keys(SESSION_MODE_LABELS) as SessionMode[]).map((value) => (
                <label key={value} className="session-form__check">
                  <input type="radio" name="session-mode" checked={mode === value} onChange={() => setMode(value)} /> {SESSION_MODE_LABELS[value]}
                </label>
              ))}
            </div>
            <label className="session-form__check">
              <input type="checkbox" checked={membersMayPrice} onChange={(e) => setMembersMayPrice(e.target.checked)} /> اعضا اجازه‌ی ثبت قیمت دارند
            </label>
          </div>

          <div className="field">
            <label>تسویه</label>
            <div className="session-form__choices" role="radiogroup">
              {(Object.keys(SESSION_SETTLEMENT_LABELS) as SessionSettlement[]).map((value) => (
                <label key={value} className="session-form__check">
                  <input type="radio" name="session-settlement" checked={settlement === value} onChange={() => setSettlement(value)} /> {SESSION_SETTLEMENT_LABELS[value]}
                </label>
              ))}
            </div>
            {settlement === "own" && <p className="field__hint">فعلاً فقط ثبت می‌شود؛ صورت‌حساب جداگانه‌ی نشست در نسخه‌های بعدی اضافه می‌شود و تا آن زمان سند نشست مثل همیشه به تراز ایونت می‌رود.</p>}
          </div>

          {!session && treasurerName && <p className="field__hint">مدیر نشست: {treasurerName} (مسئول صندوق)</p>}
          {error && <p className="field__error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={onClose}>
              انصراف
            </button>
            <button type="button" className="form-actions__primary" disabled={saving || !title.trim() || participants.length === 0} onClick={handleSubmit}>
              {session ? "ذخیره" : "ایجاد و ورود به نشست"}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
