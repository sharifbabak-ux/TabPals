import type { OrderSessionStatus } from "@/data/types";
import { SESSION_STATUS_LABELS } from "./orderLabels";
import "./orders.css";

export function SessionStatusChip({ status }: { status: OrderSessionStatus }) {
  return <span className={`status-chip status-chip--${status}`}>{SESSION_STATUS_LABELS[status]}</span>;
}
