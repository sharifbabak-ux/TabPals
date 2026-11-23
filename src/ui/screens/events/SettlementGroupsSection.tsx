import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { SETTLEMENT_GROUP_ERROR_MESSAGES, settlementGroupsRepository } from "@/data/repositories/settlementGroupsRepository";
import type { SettlementGroup } from "@/data/types";
import { toPersianDigits } from "@/domain/format";
import { validateGroups } from "@/domain/settlementUnits";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { HelpHint } from "@/ui/components/HelpHint";
import { SettlementGroupSheet } from "./SettlementGroupSheet";
import { SG_HELP, SG_TEXT } from "./settlementGroupLabels";
import "./eventForm.css";
import "./settlementGroups.css";

interface SettlementGroupsSectionProps {
  eventId: string;
  treasurerPersonId: string | null;
  /** Offline: the owner. Online: admin or treasurer. Everyone else sees a read-only list. */
  canEdit: boolean;
  /** Online event: groups are synced (SG-6). Offline events keep them on this device only. */
  online?: boolean;
}

/** «گروه‌های تسویه» in the event's members tab (docs/PLAN.md, SG-3). */
export function SettlementGroupsSection({ eventId, treasurerPersonId, canEdit, online = false }: SettlementGroupsSectionProps) {
  const members = useEventMembers(eventId);
  const groups = useLiveQuery(() => settlementGroupsRepository.listByEvent(eventId), [eventId]);
  const [sheet, setSheet] = useState<{ group?: SettlementGroup } | null>(null);

  if (!members || !groups) return null;
  const nameOf = new Map(members.map((m) => [m.personId, m.name]));
  // Concurrent edits from two devices can leave an invalid set; the views fall back to individual mode, so tell the user clearly.
  const problems = [
    ...new Set(
      validateGroups(
        groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId })),
        { knownPersonIds: members.map((m) => m.personId), treasurerId: treasurerPersonId ?? "" }
      ).map((e) => SETTLEMENT_GROUP_ERROR_MESSAGES[e.code])
    )
  ];

  return (
    <section className="sg-section" aria-label={SG_TEXT.sectionTitle}>
      <div className="sg-section__header">
        <div className="sg-section__title">
          <h2 className="section-title" style={{ margin: 0 }}>
            {SG_TEXT.sectionTitle}
          </h2>
          <HelpHint title={SG_HELP.section.title} body={SG_HELP.section.body} />
        </div>
        {canEdit && (
          <button type="button" className="icon-button" aria-label={SG_TEXT.addLabel} title={SG_TEXT.addLabel} onClick={() => setSheet({})}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {problems.length > 0 && (
        <div className="event-form-alert" role="alert" data-testid="sg-invalid-alert">
          <span className="event-form-alert__icon" aria-hidden="true">
            ⚠
          </span>
          <div className="event-form-alert__body">
            <strong className="event-form-alert__title">{SG_TEXT.invalidTitle}</strong>
            <p className="event-form-alert__text">{problems.join("\n")}</p>
            <p className="event-form-alert__text">{canEdit ? SG_TEXT.invalidFixEditor : SG_TEXT.invalidFixReader}</p>
          </div>
        </div>
      )}

      {groups.length === 0 && <p className="sg-empty">{canEdit ? SG_TEXT.emptyAdmin : SG_TEXT.emptyReader}</p>}

      <ul className="sg-list">
        {groups.map((group) => {
          const body = (
            <div className="list-item__main">
              <span className="list-item__title">{group.name}</span>
              <span className="list-item__subtitle">
                {SG_TEXT.membersCount(toPersianDigits(group.memberIds.length))} · {SG_TEXT.representative}: {nameOf.get(group.representativeId) ?? "؟"}
              </span>
            </div>
          );
          return (
            <li key={group.id}>
              {canEdit ? (
                <button type="button" className="list-item sg-item" onClick={() => setSheet({ group })}>
                  {body}
                </button>
              ) : (
                <div className="list-item sg-item" style={{ cursor: "default" }}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!canEdit && <p className="field__hint sg-note">{online ? SG_TEXT.readOnlyNoteOnline : SG_TEXT.readOnlyNote}</p>}
      {!online && <p className="field__hint sg-note">{SG_TEXT.onlineLocalNote}</p>}

      {canEdit && (
        <SettlementGroupSheet
          open={sheet !== null}
          eventId={eventId}
          group={sheet?.group}
          groups={groups}
          members={members}
          treasurerPersonId={treasurerPersonId}
          onClose={() => setSheet(null)}
          onSaved={() => setSheet(null)}
        />
      )}
    </section>
  );
}
