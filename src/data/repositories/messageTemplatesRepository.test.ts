import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { messageTemplatesRepository } from "./messageTemplatesRepository";

describe("messageTemplatesRepository", () => {
  it("seeds 15 enabled default templates across the four categories on first run", async () => {
    const templates = await messageTemplatesRepository.list();
    expect(templates).toHaveLength(15);
    expect(templates.every((t) => t.isDefault && t.enabled)).toBe(true);
    expect(templates.filter((t) => t.category === "debtor")).toHaveLength(5);
    expect(templates.filter((t) => t.category === "creditor")).toHaveLength(4);
    expect(templates.filter((t) => t.category === "settled")).toHaveLength(3);
    expect(templates.filter((t) => t.category === "treasurer")).toHaveLength(3);
  });

  describe("create/update/remove", () => {
    let createdId: string;

    beforeEach(async () => {
      const created = await messageTemplatesRepository.create({ category: "debtor", text: "متن آزمایشی" });
      createdId = created.id;
    });

    it("creates a non-default, enabled template", async () => {
      const templates = await messageTemplatesRepository.list();
      const created = templates.find((t) => t.id === createdId);
      expect(created).toMatchObject({ category: "debtor", text: "متن آزمایشی", enabled: true, isDefault: false });
    });

    it("rejects empty text", async () => {
      await expect(messageTemplatesRepository.create({ category: "debtor", text: "   " })).rejects.toThrow();
    });

    it("updates text and enabled state", async () => {
      await messageTemplatesRepository.update(createdId, { text: "متن ویرایش‌شده", enabled: false });
      const updated = await db.messageTemplates.get(createdId);
      expect(updated?.text).toBe("متن ویرایش‌شده");
      expect(updated?.enabled).toBe(false);
    });

    it("soft-deletes a custom template", async () => {
      await messageTemplatesRepository.remove(createdId);
      const templates = await messageTemplatesRepository.list();
      expect(templates.find((t) => t.id === createdId)).toBeUndefined();
      expect((await db.messageTemplates.get(createdId))?.deleted).toBe(true);
    });

    it("refuses to delete a default template", async () => {
      const [defaultTemplate] = (await messageTemplatesRepository.list()).filter((t) => t.isDefault);
      await expect(messageTemplatesRepository.remove(defaultTemplate.id)).rejects.toThrow();
    });
  });

  describe("restoreDefaults", () => {
    it("discards edits to default templates and restores the pristine 15, leaving custom templates untouched", async () => {
      const [someDefault] = (await messageTemplatesRepository.list()).filter((t) => t.isDefault);
      await messageTemplatesRepository.update(someDefault.id, { text: "متن دستکاری‌شده", enabled: false });
      const custom = await messageTemplatesRepository.create({ category: "creditor", text: "متن سفارشی من" });

      await messageTemplatesRepository.restoreDefaults();

      const templates = await messageTemplatesRepository.list();
      const defaults = templates.filter((t) => t.isDefault);
      expect(defaults).toHaveLength(15);
      expect(defaults.every((t) => t.enabled)).toBe(true);
      expect(defaults.some((t) => t.text === "متن دستکاری‌شده")).toBe(false);
      expect(templates.find((t) => t.id === custom.id)?.text).toBe("متن سفارشی من");
    });
  });
});
