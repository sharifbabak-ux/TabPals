import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { messageTemplatesRepository } from "@/data/repositories";
import type { MessageTemplate, MessageTemplateCategory } from "@/data/types";
import { fillTemplate } from "@/domain/messageTemplate";
import { EmptyState } from "@/ui/components/EmptyState";
import { Switch } from "@/ui/components/Switch";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { SAMPLE_PLACEHOLDERS, TemplateFormSheet } from "./TemplateFormSheet";
import "./MessageTemplatesSection.css";

const CATEGORY_ORDER: MessageTemplateCategory[] = ["debtor", "creditor", "settled", "treasurer"];
const CATEGORY_LABELS: Record<MessageTemplateCategory, string> = {
  debtor: "بدهکاران",
  creditor: "بستانکاران",
  settled: "حساب صاف",
  treasurer: "مسئول صندوق"
};

/** Settings → "متن‌های صورت‌حساب" (docs/PLAN.md Stage 3B UI): list by category, edit/add/enable-disable, restore defaults, live preview. */
export function MessageTemplatesSection() {
  const [formState, setFormState] = useState<{ category: MessageTemplateCategory; template?: MessageTemplate } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = useLiveQuery(() => db.messageTemplates.filter((t) => !t.deleted).toArray(), []);

  const byCategory = useMemo(() => {
    const map = new Map<MessageTemplateCategory, MessageTemplate[]>();
    for (const category of CATEGORY_ORDER) map.set(category, []);
    for (const template of templates ?? []) {
      map.get(template.category)?.push(template);
    }
    return map;
  }, [templates]);

  async function handleSubmit(input: { text: string; enabled: boolean }) {
    if (!formState) return;
    if (formState.template) {
      await messageTemplatesRepository.update(formState.template.id, input);
    } else {
      await messageTemplatesRepository.create({ category: formState.category, text: input.text });
    }
    setFormState(null);
  }

  async function handleRemove(template: MessageTemplate) {
    setError(null);
    try {
      await messageTemplatesRepository.remove(template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function handleRestoreDefaults() {
    await messageTemplatesRepository.restoreDefaults();
    setConfirmRestore(false);
  }

  return (
    <section>
      <div className="screen-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          متن‌های صورت‌حساب
        </h2>
        <button type="button" className="icon-button icon-button--ghost icon-button--label" onClick={() => setConfirmRestore(true)}>
          بازگردانی متن‌های پیش‌فرض
        </button>
      </div>

      {error && <p className="field__error">{error}</p>}

      {CATEGORY_ORDER.map((category) => {
        const categoryTemplates = byCategory.get(category) ?? [];
        return (
          <div key={category} className="template-category">
            <div className="screen-header">
              <h3 className="section-title" style={{ margin: 0 }}>
                {CATEGORY_LABELS[category]}
              </h3>
              <button type="button" className="icon-button" onClick={() => setFormState({ category })} aria-label="متن جدید">
                +
              </button>
            </div>

            {categoryTemplates.length === 0 && <EmptyState hint="متنی در این دسته وجود ندارد." />}

            <ul className="list">
              {categoryTemplates.map((template) => (
                <li key={template.id} className="list-item template-list-item">
                  <div className="list-item__main">
                    <span className="list-item__title">{template.text}</span>
                    <span className="list-item__subtitle template-preview">{fillTemplate(template.text, SAMPLE_PLACEHOLDERS)}</span>
                  </div>
                  <div className="template-list-item__actions">
                    <Switch
                      checked={template.enabled}
                      onChange={(enabled) => messageTemplatesRepository.update(template.id, { enabled })}
                      label="فعال"
                    />
                    <button type="button" className="list-item__action" onClick={() => setFormState({ category, template })}>
                      ویرایش
                    </button>
                    {!template.isDefault && (
                      <button type="button" className="list-item__action" onClick={() => handleRemove(template)}>
                        حذف
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <TemplateFormSheet
        open={formState !== null}
        category={formState?.category ?? "debtor"}
        template={formState?.template}
        onClose={() => setFormState(null)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={confirmRestore}
        title="بازگردانی متن‌های پیش‌فرض"
        message="همه‌ی متن‌های پیش‌فرض ویرایش‌شده به نسخه‌ی اصلی بازمی‌گردند. متن‌های سفارشی شما دست‌نخورده می‌مانند."
        confirmLabel="بازگردانی"
        onConfirm={handleRestoreDefaults}
        onCancel={() => setConfirmRestore(false)}
      />
    </section>
  );
}
