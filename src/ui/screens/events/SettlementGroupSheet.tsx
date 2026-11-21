import { useEffect, useMemo, useState } from "react";
import { settlementGroupsRepository, SettlementGroupValidationError } from "@/data/repositories/settlementGroupsRepository";
import type { SettlementGroup } from "@/data/types";
import { draftErrors, normalizeDraft, otherGroupOf, toggleDraftMember, treasurerIsLocked, type DraftErrorCode, type GroupDraft } from "@/domain/settlementGroupForm";
import type { EventMemberOption } from "@/ui/hooks/useEventMembers";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { HelpHint } from "@/ui/components/HelpHint";
import { DRAFT_ERROR_MESSAGES, SG_HELP, SG_TEXT } from "./settlementGroupLabels";
import "./settlementGroups.css";

interface SettlementGroupSheetProps {
  open: boolean;
  eventId: string;
  /** Present when editing. */
  group?: SettlementGroup;
  /** All live groups of the event. */
  groups: SettlementGroup[];
  /** Every member row of the event (inactive too) with display names. */
  members: EventMemberOption[];
  treasurerPersonId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Create / edit / delete one settlement group in a bottom sheet (docs/PLAN.md, SG-3). */
export function SettlementGroupSheet({ open, eventId, group, groups, members, treasurerPersonId, onClose, onSaved }: SettlementGroupSheetProps) {
  const [draft, setDraft] = useState<GroupDraft>({ name: "", memberIds: [], representativeId: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(group ? normalizeDraft({ name: group.name, memberIds: group.memberIds, representativeId: group.representativeId }, treasurerPersonId) : { name: "", memberIds: [], representativeId: null });
    setError(null);
    setBusy(false);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.id]);

  const nameOf = useMemo(() => new Map(members.map((m) => [m.personId, m.name])), [members]);
  // Active people, plus anyone already in this group (so nobody silently disappears).
  const options = members.filter((m) => m.active || group?.memberIds.includes(m.personId));
  const treasurerName = treasurerPersonId ? nameOf.get(treasurerPersonId) ?? "؟" : "";
  const locked = treasurerIsLocked(draft, treasurerPersonId);

  const errors = draftErrors(draft, {
    knownPersonIds: members.map((m) => m.personId),
    treasurerId: treasurerPersonId ?? "",
    groups,
    editingId: group?.id ?? null
  });
  const valid = errors.length === 0;

  function messagesFor(codes: readonly DraftErrorCode[]): string {
    return [...new Set(codes.map((c) => DRAFT_ERROR_MESSAGES[c]))].join(" ");
  }

  async function handleSave() {
    if (!valid || !draft.representativeId) return;
    setBusy(true);
    setError(null);
    try {
      const input = { name: draft.name, memberIds: draft.memberIds, representativeId: draft.representativeId };
      if (group) await settlementGroupsRepository.update(group.id, input);
      else await settlementGroupsRepository.create({ eventId, ...input });
      onSaved();
    } catch (e) {
      setError(e instanceof SettlementGroupValidationError ? messagesFor(e.errors.map((x) => x.code)) : SG_TEXT.genericSaveError);
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!group) return;
    setConfirmDelete(false);
    setBusy(true);
    setError(null);
    try {
      await settlementGroupsRepository.delete(group.id);
      onSaved();
    } catch {
      setError(SG_TEXT.genericDeleteError);
      setBusy(false);
    }
  }

  const selected = draft.memberIds.filter((id) => nameOf.has(id));

  return (
    <>
      <BottomSheet open={open} title={group ? SG_TEXT.editTitle : SG_TEXT.newTitle} onClose={onClose}>
        <div className="field">
          <label htmlFor="sg-name">{SG_TEXT.nameLabel}</label>
          <input id="sg-name" value={draft.name} placeholder={SG_TEXT.namePlaceholder} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>

        <div className="field">
          <label>{SG_TEXT.membersLabel}</label>
          <p className="field__hint">{SG_TEXT.membersHint}</p>
          {options.length === 0 && <p className="field__hint">{SG_TEXT.noPeople}</p>}
          <div className="sg-people">
            {options.map((m) => {
              const other = otherGroupOf(groups, m.personId, group?.id ?? null);
              const isSelected = draft.memberIds.includes(m.personId);
              return (
                <button
                  key={m.personId}
                  type="button"
                  className={`sg-chip${isSelected ? " sg-chip--selected" : ""}`}
                  aria-pressed={isSelected}
                  disabled={Boolean(other)}
                  onClick={() => setDraft(toggleDraftMember(draft, m.personId, treasurerPersonId))}
                >
                  <span>{m.name}</span>
                  {other && <span className="sg-chip__note">{SG_TEXT.inOtherGroup(other.name)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="sg-label-row">
            <label id="sg-rep-label">{SG_TEXT.representativeLabel}</label>
            <HelpHint title={SG_HELP.representative.title} body={SG_HELP.representative.body} />
          </div>
          {selected.length === 0 ? (
            <p className="field__hint">{SG_TEXT.representativePick}</p>
          ) : (
            <div className="sg-reps" role="radiogroup" aria-labelledby="sg-rep-label">
              {selected.map((id) => (
                <label key={id} className="sg-rep">
                  <input
                    type="radio"
                    name="sg-representative"
                    checked={draft.representativeId === id}
                    disabled={locked}
                    onChange={() => setDraft({ ...draft, representativeId: id })}
                  />
                  {nameOf.get(id)}
                </label>
              ))}
            </div>
          )}
          {locked && (
            <div className="sg-lock">
              <p className="field__hint">{SG_TEXT.treasurerLock(treasurerName)}</p>
              <HelpHint title={SG_HELP.treasurerLock.title} body={SG_HELP.treasurerLock.body} />
            </div>
          )}
        </div>

        {!valid && (
          <ul className="sg-errors" aria-live="polite">
            {errors.map((code) => (
              <li key={code} className="field__warning">
                {DRAFT_ERROR_MESSAGES[code]}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            {SG_TEXT.cancel}
          </button>
          <button type="button" className="form-actions__primary" disabled={!valid || busy} onClick={handleSave}>
            {group ? SG_TEXT.save : SG_TEXT.create}
          </button>
        </div>
        {group && (
          <button type="button" className="sheet__archive-button sheet__archive-button--danger sg-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {SG_TEXT.delete}
          </button>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete}
        title={SG_TEXT.deleteTitle}
        message={SG_TEXT.deleteMessage(group?.name ?? "")}
        confirmLabel={SG_TEXT.deleteConfirm}
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
