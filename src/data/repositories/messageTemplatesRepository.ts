import { DEFAULT_MESSAGE_TEMPLATES } from "@/domain/messageTemplateDefaults";
import { db } from "../db";
import type { MessageTemplate, MessageTemplateCategory } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

const TEMPLATE_LOG_FIELDS: (keyof MessageTemplate)[] = ["category", "text", "enabled", "isDefault"];

export interface MessageTemplateInput {
  category: MessageTemplateCategory;
  text: string;
}

function requireNonEmptyText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("متن نمی‌تواند خالی باشد");
  return trimmed;
}

export const messageTemplatesRepository = {
  async list(): Promise<MessageTemplate[]> {
    return db.messageTemplates.filter((t) => !t.deleted).toArray();
  },

  async create(input: MessageTemplateInput): Promise<MessageTemplate> {
    const template: MessageTemplate = {
      ...newBaseFields(),
      category: input.category,
      text: requireNonEmptyText(input.text),
      enabled: true,
      isDefault: false
    };
    await db.transaction("rw", db.messageTemplates, db.operations, async () => {
      await db.messageTemplates.add(template);
      await logOperation(db, "messageTemplates", template.id, "create", diffFields(undefined, template, TEMPLATE_LOG_FIELDS));
    });
    return template;
  },

  /** Edits a template's text and/or enabled state. Works on both custom and default templates (editing a default detaches it from "پیش‌فرض" only via restoreDefaults, not automatically). */
  async update(id: string, changes: { text?: string; enabled?: boolean }): Promise<void> {
    await db.transaction("rw", db.messageTemplates, db.operations, async () => {
      const existing = await db.messageTemplates.get(id);
      if (!existing) throw new Error(`Template ${id} not found`);

      const updated: MessageTemplate = {
        ...existing,
        ...(changes.text !== undefined ? { text: requireNonEmptyText(changes.text) } : {}),
        ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
        ...touchBaseFields(existing)
      };
      const diff = diffFields(existing, updated, TEMPLATE_LOG_FIELDS);
      if (Object.keys(diff).length === 0) return;
      await db.messageTemplates.put(updated);
      await logOperation(db, "messageTemplates", id, "update", diff);
    });
  },

  /** Soft-deletes a user-created template. Default templates can only be disabled, never removed (restoreDefaults brings them back if edited). */
  async remove(id: string): Promise<void> {
    await db.transaction("rw", db.messageTemplates, db.operations, async () => {
      const existing = await db.messageTemplates.get(id);
      if (!existing) throw new Error(`Template ${id} not found`);
      if (existing.isDefault) throw new Error("متن‌های پیش‌فرض قابل حذف نیستند؛ می‌توانید آن را غیرفعال کنید.");
      const updated: MessageTemplate = { ...existing, deleted: true, ...touchBaseFields(existing) };
      await db.messageTemplates.put(updated);
      await logOperation(db, "messageTemplates", id, "archive", diffFields(existing, updated, ["deleted"]));
    });
  },

  /**
   * "بازگردانی متن‌های پیش‌فرض": discards any edits to the default templates
   * and recreates the pristine seed set (enabled, original text).
   * User-created templates (isDefault: false) are left untouched.
   */
  async restoreDefaults(): Promise<void> {
    await db.transaction("rw", db.messageTemplates, db.operations, async () => {
      const existingDefaults = await db.messageTemplates.filter((t) => t.isDefault && !t.deleted).toArray();
      for (const existing of existingDefaults) {
        const updated: MessageTemplate = { ...existing, deleted: true, ...touchBaseFields(existing) };
        await db.messageTemplates.put(updated);
        await logOperation(db, "messageTemplates", existing.id, "archive", diffFields(existing, updated, ["deleted"]));
      }

      for (const seed of DEFAULT_MESSAGE_TEMPLATES) {
        const template: MessageTemplate = { ...newBaseFields(), category: seed.category, text: seed.text, enabled: true, isDefault: true };
        await db.messageTemplates.add(template);
        await logOperation(db, "messageTemplates", template.id, "create", diffFields(undefined, template, TEMPLATE_LOG_FIELDS));
      }
    });
  }
};
