import { toPersianDigits } from "@/domain/format";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
}

/** − n + stepper for integer quantities (≥ min, default 1). */
export function QuantityStepper({ value, onChange, min = 1, disabled }: QuantityStepperProps) {
  return (
    <div className="qty-stepper" role="group" aria-label="تعداد">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="کم کردن">
        −
      </button>
      <span className="qty-stepper__value">{toPersianDigits(value)}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled} aria-label="زیاد کردن">
        +
      </button>
    </div>
  );
}
