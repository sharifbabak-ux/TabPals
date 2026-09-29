import { useEffect, useRef, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Switch } from "@/ui/components/Switch";
import { fillTemplate, type TemplatePlaceholders } from "@/domain/messageTemplate";
import type { MessageTemplate, MessageTemplateCategory } from "@/data/types";

const PLACEHOLDER_CHIPS = ["{name}", "{amount}", "{currency}", "{treasurer}", "{event}", "{balanceText}"];

/** Sample values for the live preview in Settings → "متن‌های صورت‌حساب". */
export const SAMPLE_PLACEHOLDERS: TemplatePlaceholders = {
  name: "علی",
  amount: "۱۵۰٬۰۰۰",
  currency: "تومان",
  treasurer: "رضا",
  event: "سفر شمال",
  balanceText: "۱۵۰٬۰۰۰ تومان بدهکار به صندوق"
};

interface TemplateFormSheetProps {
  open: boolean;
  category: MessageTemplateCategory;
  template?: MessageTemplate;
  onClose: () => void;
  onSubmit: (input: { text: string; enabled: boolean }) => Promise<void>;
}

/** Create/edit sheet for one closing-message template, with a live preview filled with sample values (docs/PLAN.md Stage 3B UI). */
export function TemplateFormSheet({ open, template, onClose, onSubmit }: TemplateFormSheetProps) {
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(template?.text ?? "");
      setEnabled(template?.enabled ?? true);
      setError(null);
    }
  }, [open, template]);

  /** Auto-grows the textarea to fit its content instead of scrolling inside a fixed box (docs/PLAN.md Stage 3B.1). */
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (open) autoGrow();
  }, [open, text]);

  const preview = text.trim() ? fillTemplate(text, SAMPLE_PLACEHOLDERS) : "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ text, enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title={template ? "ویرایش متن" : "متن جدید"} onClose={onClose} fullScreen>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="template-text">متن</label>
          <textarea
            id="template-text"
            className="reason-textarea reason-textarea--autogrow"
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            autoFocus
          />
          <p className="field__hint">جای‌گذاری‌های قابل استفاده:</p>
          <div className="placeholder-chips">
            {PLACEHOLDER_CHIPS.map((chip) => (
              <span key={chip} className="placeholder-chip">
                {chip}
              </span>
            ))}
          </div>
        </div>

        {template && <Switch checked={enabled} onChange={setEnabled} label="فعال" />}

        {preview && (
          <div className="field">
            <span>پیش‌نمایش</span>
            <p className="template-preview">{preview}</p>
          </div>
        )}

        {error && <p className="field__error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!text.trim() || submitting}>
            ذخیره
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
