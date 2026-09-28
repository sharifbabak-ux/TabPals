interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** Toggle switch used in place of plain checkboxes across list screens (Stage 2 task description part A.3). */
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
        <span className="switch__track" />
      </span>
    </label>
  );
}
