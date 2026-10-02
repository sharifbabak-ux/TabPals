import { BottomSheet } from "@/ui/components/BottomSheet";

interface RecordedByMenuSheetProps {
  open: boolean;
  onClose: () => void;
  onSelectGroupOrder: () => void;
  onSelectTreasurer: () => void;
}

/** First question when "+" is tapped on the vouchers tab: who records the expense (docs/PLAN.md Group Order UI #2). */
export function RecordedByMenuSheet({ open, onClose, onSelectGroupOrder, onSelectTreasurer }: RecordedByMenuSheetProps) {
  return (
    <BottomSheet open={open} title="ثبت هزینه" onClose={onClose}>
      <ul className="list">
        <li className="list-item" onClick={onSelectGroupOrder}>
          <div className="list-item__main">
            <span className="list-item__title">ثبت توسط اعضا (سفارش گروهی)</span>
            <span className="list-item__subtitle">هر نفر سفارش خودش را ثبت می‌کند و فاکتور دقیقاً بر اساس سفارش‌ها تقسیم می‌شود</span>
          </div>
        </li>
        <li className="list-item" onClick={onSelectTreasurer}>
          <div className="list-item__main">
            <span className="list-item__title">ثبت توسط مادرخرج</span>
            <span className="list-item__subtitle">سند را مسئول صندوق مستقیم ثبت می‌کند</span>
          </div>
        </li>
      </ul>
    </BottomSheet>
  );
}
