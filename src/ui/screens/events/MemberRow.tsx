import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "@/ui/components/Avatar";
import { DragHandleIcon } from "@/ui/components/icons";

interface MemberRowProps {
  id: string;
  personId: string;
  name: string;
  photo?: Blob;
  active: boolean;
  isTreasurer: boolean;
  /** True on a closed event: drag handle and the (de)activate button are muted/disabled (see CLAUDE.md). */
  disabled: boolean;
  /** Read-only member of an online event: no drag handle, no (de)activate button. */
  readOnly?: boolean;
  /** Admin of an online event, member without an active device: shows «دعوت». */
  onInvite?: () => void;
  onToggleActive: () => void;
}

/** One draggable member row in the event members list (docs/PLAN.md Stage 3A UI #5). */
export function MemberRow({ id, personId, name, photo, active, isTreasurer, disabled, readOnly = false, onInvite, onToggleActive }: MemberRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined
  };

  return (
    <li ref={setNodeRef} style={style} className={`list-item member-row${active ? "" : " list-item--archived"}`}>
      {!readOnly && (
        <button
          type="button"
          className={`member-row__handle${disabled ? " member-row__handle--muted" : ""}`}
          disabled={disabled}
          aria-label="جابه‌جایی عضو"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
      )}
      <Avatar id={personId} name={name} photo={photo} />
      <div className="list-item__main">
        <span className="list-item__title">{name}</span>
      </div>
      <div className="list-item__meta">
        {isTreasurer && <span className="badge badge--treasurer">مسئول صندوق</span>}
        {onInvite && active && (
          <button type="button" className="list-item__action" onClick={onInvite}>
            دعوت
          </button>
        )}
        {!readOnly && (
          <button type="button" className="list-item__action" disabled={disabled} onClick={onToggleActive}>
            {active ? "غیرفعال کردن" : "فعال کردن"}
          </button>
        )}
      </div>
    </li>
  );
}
