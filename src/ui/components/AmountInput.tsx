import { useEffect, useState } from "react";
import { parseAmountInput } from "@/domain/amountInput";
import { formatAmount } from "@/domain/format";

interface AmountInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  autoFocus?: boolean;
  large?: boolean;
  placeholder?: string;
}

/**
 * Numeric amount input with live Persian thousand separators. Accepts
 * Persian/Arabic/English digits (docs/PLAN.md #4, Stage 2 task description
 * part C — amount input parsing).
 */
export function AmountInput({ id, value, onChange, autoFocus, large, placeholder }: AmountInputProps) {
  const [text, setText] = useState(value ? formatAmount(value) : "");

  useEffect(() => {
    setText(value ? formatAmount(value) : "");
    // Only resync from external value changes (e.g. resetting the form), not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === 0]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const parsed = parseAmountInput(raw);
    setText(raw.trim() === "" ? "" : formatAmount(parsed));
    onChange(parsed);
  }

  return (
    <input
      id={id}
      className={large ? "amount-input amount-input--large" : "amount-input"}
      type="text"
      inputMode="numeric"
      dir="ltr"
      value={text}
      onChange={handleChange}
      autoFocus={autoFocus}
      placeholder={placeholder}
    />
  );
}
