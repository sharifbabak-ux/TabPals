import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { settlementGroupsRepository } from "@/data/repositories/settlementGroupsRepository";
import type { SettlementGroup } from "@/data/types";
import { toPersianDigits } from "@/domain/format";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { HelpHint } from "@/ui/components/HelpHint";
import { SettlementGroupSheet } from "./SettlementGroupSheet";
import { SG_HELP, SG_TEXT } from "./settlementGroupLabels";
import "./settlementGroups.css";

interface SettlementGroupsSectionProps {
  eventId: string;
  treasurerPersonId: string | null;
  /** Only the event admin/owner may create, edit or delete; everyone else sees a read-only list. */
  canEdit: boolean;
  /** Online event: groups are not synced yet (SG-6), so say where they live. */
  online?: boolean;
}

/** «گروه‌های تسویه» in the event's members tab (docs/PLAN.md, SG-3). */
export function SettlementGroupsSection({ eventId, treasurerPersonId, canEdit, online = false }: SettlementGroupsSectionProps) {
  const members = useEventMembers(eventId);
  const groups = useLiveQuery(() => settlementGroupsRepository.listByEvent(eventId), [eventId]);
  const [sheet, setSheet] = useState<{ group?: SettlementGroup } | null>(null);

  if (!members || !groups) return null;
  const nameOf = new Map(members.map((m) => [m.personId, m.name]));

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

      {!canEdit && <p className="field__hint sg-note">{SG_TEXT.readOnlyNote}</p>}
      {online && <p className="field__hint sg-note">{SG_TEXT.onlineLocalNote}</p>}

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
