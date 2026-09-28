interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Generic segmented tab bar (اشخاص | گروه‌ها, اعضا | اسناد, theme selector). */
export function Tabs<T extends string>({ options, value, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`tabs__tab${option.value === value ? " tabs__tab--active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
