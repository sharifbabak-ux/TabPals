interface WeightsEditorProps {
  persons: { personId: string; name: string }[];
  weights: Record<string, number>;
  onChange: (weights: Record<string, number>) => void;
}

/** One weight input per person (0 = this person is left out) for the "با ضریب" allocation. */
export function WeightsEditor({ persons, weights, onChange }: WeightsEditorProps) {
  return (
    <ul className="checklist">
      {persons.map((p) => (
        <li key={p.personId} className="split-row">
          <span className="split-row__name">{p.name}</span>
          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            aria-label={`ضریب ${p.name}`}
            value={weights[p.personId] ?? ""}
            placeholder="۰"
            onChange={(e) => {
              const raw = Number(e.target.value.replace(/[^\d.]/g, ""));
              onChange({ ...weights, [p.personId]: Number.isFinite(raw) ? raw : 0 });
            }}
          />
        </li>
      ))}
    </ul>
  );
}
