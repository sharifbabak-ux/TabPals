import { LogoMark } from "./Logo";

interface EmptyStateProps {
  hint: string;
}

/** Faded logo mark with a short Persian hint, shown instead of an empty list. */
export function EmptyState({ hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <LogoMark size={56} className="empty-state__mark" />
      <p className="empty-state__hint">{hint}</p>
    </div>
  );
}
