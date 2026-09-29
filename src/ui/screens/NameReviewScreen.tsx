import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { personsRepository } from "@/data/repositories";
import type { Person } from "@/data/types";
import { EmptyState } from "@/ui/components/EmptyState";

interface RowState {
  firstName: string;
  lastName: string;
  error: string | null;
  busy: boolean;
}

/**
 * "بررسی نام‌ها" — one-time (and always reachable from Settings until
 * everyone is confirmed) review of persons split by the v6 name migration
 * (docs/PLAN.md Stage 3B.1). Each row is independently editable and
 * confirmable; "تأیید همه" accepts the current (possibly edited) values
 * for every remaining row in one action.
 */
export function NameReviewScreen() {
  const navigate = useNavigate();
  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && p.needsNameReview === true).toArray(), []);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [confirmingAll, setConfirmingAll] = useState(false);

  useEffect(() => {
    if (!persons) return;
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const person of persons) {
        next[person.id] = prev[person.id] ?? { firstName: person.firstName, lastName: person.lastName, error: null, busy: false };
      }
      return next;
    });
  }, [persons]);

  async function confirmRow(person: Person) {
    const row = rows[person.id];
    if (!row) return;
    setRows((prev) => ({ ...prev, [person.id]: { ...row, busy: true, error: null } }));
    try {
      await personsRepository.confirmNameReview(person.id, { firstName: row.firstName, lastName: row.lastName });
    } catch (e) {
      setRows((prev) => ({ ...prev, [person.id]: { ...row, busy: false, error: e instanceof Error ? e.message : "خطایی رخ داد" } }));
    }
  }

  async function confirmAll() {
    if (!persons) return;
    setConfirmingAll(true);
    for (const person of persons) {
      await confirmRow(person);
    }
    setConfirmingAll(false);
  }

  if (persons && persons.length === 0) {
    return (
      <div className="screen">
        <button type="button" className="back-link" onClick={() => navigate("/settings")}>
          ← بازگشت به تنظیمات
        </button>
        <h1>بررسی نام‌ها</h1>
        <EmptyState hint="همه‌ی نام‌ها بررسی شده‌اند." />
      </div>
    );
  }

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate("/settings")}>
        ← بازگشت به تنظیمات
      </button>
      <div className="screen-header">
        <h1>بررسی نام‌ها</h1>
        <button type="button" className="icon-button icon-button--ghost icon-button--label" disabled={confirmingAll} onClick={confirmAll}>
          تأیید همه
        </button>
      </div>
      <p>
        در به‌روزرسانی اخیر، نام افراد به «نام» و «نام خانوادگی» تقسیم شد. لطفاً موارد زیر را بررسی و در صورت نیاز اصلاح کنید.
      </p>

      <ul className="list">
        {(persons ?? []).map((person) => {
          const row = rows[person.id];
          if (!row) return null;
          return (
            <li key={person.id} className="list-item name-review-row">
              <div className="name-review-row__fields">
                <div className="field">
                  <label htmlFor={`review-first-${person.id}`}>نام</label>
                  <input
                    id={`review-first-${person.id}`}
                    value={row.firstName}
                    onChange={(event) => setRows((prev) => ({ ...prev, [person.id]: { ...row, firstName: event.target.value } }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`review-last-${person.id}`}>نام خانوادگی</label>
                  <input
                    id={`review-last-${person.id}`}
                    value={row.lastName}
                    onChange={(event) => setRows((prev) => ({ ...prev, [person.id]: { ...row, lastName: event.target.value } }))}
                  />
                </div>
                {row.error && <p className="field__error">{row.error}</p>}
              </div>
              <button type="button" className="list-item__action" disabled={row.busy} onClick={() => confirmRow(person)}>
                تأیید
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
