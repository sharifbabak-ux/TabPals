import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { EmptyState } from "@/ui/components/EmptyState";
import { toPersianDigits } from "@/domain/format";
import { buildImportCandidates, selectAllCandidates, selectNoCandidates, toggleCandidateSelection } from "@/domain/memberImport";

interface AddMembersSheetProps {
  open: boolean;
  /** Person ids already active in this event, excluded from the checklist. */
  excludePersonIds: string[];
  onClose: () => void;
  onSubmit: (personIds: string[]) => Promise<void>;
}

/** Action 1 — add members from the full people directory, with search and multi-select. */
export function AddMembersSheet({ open, excludePersonIds, onClose, onSubmit }: AddMembersSheetProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && !p.archived).toArray(), []);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
    }
  }, [open]);

  const candidates = useMemo(() => {
    const all = (persons ?? []).map((p) => ({ personId: p.id, name: p.name }));
    return buildImportCandidates(all, excludePersonIds);
  }, [persons, excludePersonIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((candidate) => candidate.name.toLowerCase().includes(term));
  }, [candidates, search]);

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
    <BottomSheet open={open} title="افزودن از اشخاص" onClose={onClose}>
      <input
        className="search-input"
        type="search"
        placeholder="جستجوی نام..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="checklist-actions">
        <button type="button" onClick={() => setSelected(selectAllCandidates(filtered))}>
          انتخاب همه
        </button>
        <button type="button" onClick={() => setSelected(selectNoCandidates())}>
          هیچ‌کدام
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hint="شخصی برای افزودن پیدا نشد." />
      ) : (
        <ul className="checklist">
          {filtered.map((candidate) => (
            <li key={candidate.personId} className="checklist-item">
              <input
                type="checkbox"
                id={`add-member-${candidate.personId}`}
                checked={selected.has(candidate.personId)}
                onChange={() => setSelected((prev) => toggleCandidateSelection(prev, candidate.personId))}
              />
              <label htmlFor={`add-member-${candidate.personId}`}>{candidate.name}</label>
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
    </BottomSheet>
  );
}
