interface EmptyStateProps {
  hint: string;
}

/** Short Persian hint shown instead of an empty list. */
export function EmptyState({ hint }: EmptyStateProps) {
  return <p className="empty-state">{hint}</p>;
}
