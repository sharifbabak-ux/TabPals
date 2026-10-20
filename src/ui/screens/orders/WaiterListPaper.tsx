import { forwardRef } from "react";
import { toPersianDigits } from "@/domain/format";
import { groupWaiterListByCategory, waiterListShowsHeadings, type WaiterItem } from "@/domain/groupOrder";
import { ORDER_CATEGORY_LABELS } from "@/domain/orderCategory";

interface WaiterListPaperProps {
  title: string;
  items: WaiterItem[];
}

/** Print-style waiter list used only for the image export (offscreen); cream / olive / gold, large type. */
export const WaiterListPaper = forwardRef<HTMLDivElement, WaiterListPaperProps>(function WaiterListPaper({ title, items }, ref) {
  const groups = groupWaiterListByCategory(items);
  const headings = waiterListShowsHeadings(groups);
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <div ref={ref} dir="rtl" lang="fa" style={{ background: "#F3EDDF", color: "#2b2b22", padding: 28, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}>
      <div data-export-header style={{ borderBottom: "3px solid #B8913A", paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#4E5D2F" }}>فهرست گارسون</div>
        <div style={{ fontSize: 20, marginTop: 4 }}>{title}</div>
        <div style={{ fontSize: 16, opacity: 0.7, marginTop: 2 }}>جمع: {toPersianDigits(total)} مورد</div>
      </div>
      {groups.map((group) => (
        <section key={group.category} data-export-block style={{ marginBottom: 14 }}>
          {headings && <div style={{ fontSize: 18, fontWeight: 700, color: "#B8913A", marginBottom: 6 }}>{ORDER_CATEGORY_LABELS[group.category]}</div>}
          {group.items.map((item) => (
            <div key={item.key} data-export-block style={{ padding: "8px 0", borderBottom: "1px solid #d9d0b8" }}>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                <span style={{ color: "#4E5D2F" }}>{toPersianDigits(item.quantity)} ×</span> {item.name}
              </div>
              {item.notes.map((note) => (
                <div key={note.text} style={{ fontSize: 16, opacity: 0.75 }}>
                  ↳ {note.text}
                  {note.quantity !== item.quantity ? ` (${toPersianDigits(note.quantity)})` : ""}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
});
