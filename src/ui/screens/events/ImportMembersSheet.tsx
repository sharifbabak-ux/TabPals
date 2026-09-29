import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { EmptyState } from "@/ui/components/EmptyState";
import { personFullName } from "@/domain/displayName";
import { toPersianDigits } from "@/domain/format";
import {
  buildImportCandidates,
  selectAllCandidates,
  selectNoCandidates,
  toggleCandidateSelection,
  type ImportCandidate
} from "@/domain/memberImport";

interface ImportMembersSheetProps {
  open: boolean;
  currentEventId: string;
  currentMemberPersonIds: string[];
  onClose: () => void;
  onSubmit: (personIds: string[]) => Promise<void>;
}

/** Action 3 — pick a previous event, then a checklist (select all / none) of its members not already here. */
export function ImportMembersSheet({ open, currentEventId, currentMemberPersonIds, onClose, onSubmit }: ImportMembersSheetProps) {
  const [sourceEventId, setSourceEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSourceEventId(null);
      setSelected(new Set());
    }
  }, [open]);

  const events = useLiveQuery(() => db.events.filter((event) => !event.deleted && event.id !== currentEventId).toArray(), [currentEventId]);
  const sortedEvents = useMemo(() => (events ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [events]);

  const sourceMembers = useLiveQuery(async () => {
    if (!sourceEventId) return [] as ImportCandidate[];
    const rows = await db.eventMembers
      .where("eventId")
      .equals(sourceEventId)
      .filter((member) => !member.deleted && member.active)
      .toArray();
    const persons = await db.persons.bulkGet(rows.map((row) => row.personId));
    return rows.map((row, index) => ({ personId: row.personId, name: persons[index] ? personFullName(persons[index]) : "؟" }));
  }, [sourceEventId]);

  const candidates = useMemo(
    () => buildImportCandidates(sourceMembers ?? [], currentMemberPersonIds),
    [sourceMembers, currentMemberPersonIds]
  );

  async function handleSubmit() {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(Array.from(selected));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title="وارد کردن از ایونت قبلی" onClose={onClose}>
      {sourceEventId === null ? (
        sortedEvents.length === 0 ? (
          <EmptyState hint="ایونت دیگری برای وارد کردن اعضا وجود ندارد." />
        ) : (
          <ul className="list">
            {sortedEvents.map((event) => (
              <li key={event.id} className="list-item" onClick={() => setSourceEventId(event.id)}>
                <div className="list-item__main">
                  <span className="list-item__title">{event.title}</span>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <button type="button" className="back-link" onClick={() => setSourceEventId(null)}>
            ← انتخاب ایونت دیگر
          </button>

          <div className="checklist-actions">
            <button type="button" onClick={() => setSelected(selectAllCandidates(candidates))}>
              انتخاب همه
            </button>
            <button type="button" onClick={() => setSelected(selectNoCandidates())}>
              هیچ‌کدام
            </button>
          </div>

          {candidates.length === 0 ? (
            <EmptyState hint="همه‌ی اعضای این ایونت قبلاً اضافه شده‌اند." />
          ) : (
            <ul className="checklist">
              {candidates.map((candidate) => (
                <li key={candidate.personId} className="checklist-item">
                  <input
                    type="checkbox"
                    id={`import-member-${candidate.personId}`}
                    checked={selected.has(candidate.personId)}
                    onChange={() => setSelected((prev) => toggleCandidateSelection(prev, candidate.personId))}
                  />
                  <label htmlFor={`import-member-${candidate.personId}`}>{candidate.name}</label>
                </li>
              ))}
            </ul>
          )}

          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={onClose}>
              انصراف
            </button>
            <button type="button" className="form-actions__primary" disabled={selected.size === 0 || submitting} onClick={handleSubmit}>
              افزودن ({toPersianDigits(selected.size)})
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
