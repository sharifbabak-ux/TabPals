import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import { settlementGroupsRepository as repo } from "@/data/repositories/settlementGroupsRepository";
import { SettlementGroupsSection } from "./SettlementGroupsSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const names = ["صندوق", "الف", "ب", "ج", "د"];

async function seed() {
  for (const table of db.tables) await table.clear();
  const ids: string[] = [];
  for (const n of names) ids.push((await personsRepository.create({ firstName: n, lastName: "نمونه" })).id);
  const [t, a, b, c, d] = ids;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: t });
  await eventMembersRepository.addMembers(event.id, ids);
  return { event, t, a, b, c, d };
}

async function show(eventId: string, treasurer: string | null, canEdit = true) {
  await act(async () => root.render(<SettlementGroupsSection eventId={eventId} treasurerPersonId={treasurer} canEdit={canEdit} />));
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
}
const text = () => container.textContent ?? "";
const byText = (sel: string, label: string) => [...container.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(label));
const chip = (name: string) => [...container.querySelectorAll<HTMLButtonElement>(".sg-chip")].find((e) => e.textContent?.startsWith(name))!;
const save = () => container.querySelector<HTMLButtonElement>(".form-actions__primary")!;
async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const addButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="گروه جدید"]');

describe("SettlementGroupsSection — admin", () => {
  it("shows an empty state with explanation and a + button, and ⓘ hints on the title", async () => {
    const { event, t } = await seed();
    await show(event.id, t);
    expect(text()).toContain("هنوز گروهی نساخته‌اید");
    expect(addButton()).not.toBeNull();
    expect(container.querySelector(".sg-section__title .help-hint__button")).not.toBeNull();
  });

  it("validates live: save is disabled until name, 2 members and a representative are set", async () => {
    const { event, t } = await seed();
    await show(event.id, t);
    await click(addButton()!);
    expect(save().disabled).toBe(true);
    expect(text()).toContain("نام گروه را وارد کنید.");
    expect(text()).toContain("هر گروه باید حداقل ۲ عضو داشته باشد.");

    await type(container.querySelector<HTMLInputElement>("#sg-name")!, "زوج");
    await click(chip("الف"));
    expect(save().disabled).toBe(true);
    await click(chip("ب"));
    expect(text()).toContain("یک نماینده انتخاب کنید.");
    expect(save().disabled).toBe(true);

    await click(container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')[1]);
    expect(save().disabled).toBe(false);
    expect(container.querySelector(".sg-errors")).toBeNull();
  });

  it("creates a group through the repository and lists it with count and representative", async () => {
    const { event, t, a, b } = await seed();
    await show(event.id, t);
    await click(addButton()!);
    await type(container.querySelector<HTMLInputElement>("#sg-name")!, "زوج");
    await click(chip("الف"));
    await click(chip("ب"));
    await click(container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')[1]);
    await click(save());
    await settle();
    const stored = await repo.listByEvent(event.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "زوج", memberIds: [a, b], representativeId: b });
    expect(text()).toContain("زوج");
    expect(text()).toContain("۲ نفر");
    expect(text()).toContain("نماینده: ب");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("disables a person who is already in another group and says which one", async () => {
    const { event, t, a, b } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [a, b], representativeId: a });
    await show(event.id, t);
    await click(addButton()!);
    expect(chip("الف").disabled).toBe(true);
    expect(chip("الف").textContent).toContain("در گروه «خانواده» است");
    expect(chip("ج").disabled).toBe(false);
  });

  it("forces and locks the treasurer as representative, with a one-line reason and a hint", async () => {
    const { event, t, a } = await seed();
    await show(event.id, t);
    await click(addButton()!);
    await click(chip("الف"));
    await click(chip("صندوق"));
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')];
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.disabled)).toBe(true);
    expect(radios.find((r) => r.checked)?.parentElement?.textContent).toContain("صندوق");
    expect(container.querySelector(".sg-lock")?.textContent).toBe("«صندوق» مسئول صندوق است؛ پس نماینده‌ی این گروه باید خودش باشد.");
    expect(container.querySelector(".sg-lock .help-hint__button")).not.toBeNull();
    // un-selecting the treasurer unlocks again
    await click(chip("صندوق"));
    expect(container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')[0].disabled).toBe(false);
    void a;
  });

  it("shows repository validation errors in Persian, never raw", async () => {
    const { event, t, a, b, c } = await seed();
    await show(event.id, t);
    await click(addButton()!);
    await type(container.querySelector<HTMLInputElement>("#sg-name")!, "زوج");
    await click(chip("الف"));
    await click(chip("ب"));
    await click(container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')[0]);
    // another device/tab grabs a person meanwhile: the repository now rejects the save
    await repo.create({ eventId: event.id, name: "رقیب", memberIds: [b, c], representativeId: c });
    await click(save());
    await settle();
    expect(container.querySelector(".field__error")?.textContent).toBe("هر نفر فقط در یک گروه می‌تواند باشد.");
    expect(text()).not.toMatch(/Error|SettlementGroup/);
    expect((await repo.listByEvent(event.id)).length).toBe(1);
    void a;
  });

  it("edits an existing group, and deletes it after a confirm step", async () => {
    const { event, t, a, b, c } = await seed();
    const g = await repo.create({ eventId: event.id, name: "قدیم", memberIds: [a, b], representativeId: a });
    await show(event.id, t);
    await click(byText(".sg-item", "قدیم")!);
    expect(container.querySelector<HTMLInputElement>("#sg-name")!.value).toBe("قدیم");
    await type(container.querySelector<HTMLInputElement>("#sg-name")!, "جدید");
    await click(chip("ج"));
    await click(save());
    await settle();
    expect(await repo.get(g.id)).toMatchObject({ name: "جدید", memberIds: [a, b, c], representativeId: a });

    await click(byText(".sg-item", "جدید")!);
    await click(container.querySelector<HTMLButtonElement>(".sg-delete")!);
    expect(await repo.get(g.id)).toBeDefined(); // still there: only a confirm dialog is open
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("حذف شود");
    await click(container.querySelector<HTMLButtonElement>(".confirm-dialog__confirm")!);
    await settle();
    expect(await repo.get(g.id)).toBeUndefined();
    expect(text()).toContain("هنوز گروهی نساخته‌اید");
  });

  it("works on a finished event", async () => {
    const { event, t, a, b } = await seed();
    await eventsRepository.close(event.id);
    await show(event.id, t);
    await click(addButton()!);
    await type(container.querySelector<HTMLInputElement>("#sg-name")!, "پایانی");
    await click(chip("الف"));
    await click(chip("ب"));
    await click(container.querySelectorAll<HTMLInputElement>('input[name="sg-representative"]')[0]);
    await click(save());
    await settle();
    expect((await repo.listByEvent(event.id))[0]).toMatchObject({ name: "پایانی", memberIds: [a, b] });
  });
});

describe("SettlementGroupsSection — non-admin", () => {
  it("is a read-only list: no + button, rows are not editable", async () => {
    const { event, t, a, b } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [a, b], representativeId: b });
    await show(event.id, t, false);
    expect(text()).toContain("خانواده");
    expect(text()).toContain("نماینده: ب");
    expect(addButton()).toBeNull();
    expect(container.querySelector("button.sg-item")).toBeNull();
    expect(text()).toContain("فقط مدیر رویداد");
    expect(container.querySelector(".sg-section__title .help-hint__button")).not.toBeNull();
  });

  it("shows a plain empty text without an add explanation", async () => {
    const { event, t } = await seed();
    await show(event.id, t, false);
    expect(text()).toContain("هنوز گروه تسویه‌ای ساخته نشده است.");
  });
});
