import type { DraftErrorCode } from "@/domain/settlementGroupForm";

/** All Persian text of the settlement-group UI (SG-3) in one place. */
export const SG_TEXT = {
  sectionTitle: "گروه‌های تسویه",
  addLabel: "گروه جدید",
  emptyAdmin: "هنوز گروهی نساخته‌اید. برای مثال یک زوج یا یک خانواده را در یک گروه بگذارید تا تسویه‌ی آن‌ها با هم و از طریق یک نفر انجام شود.",
  emptyReader: "هنوز گروه تسویه‌ای ساخته نشده است.",
  onlineLocalNote: "فعلاً گروه‌ها فقط روی همین دستگاه ذخیره می‌شوند.",
  readOnlyNote: "فقط مدیر رویداد می‌تواند گروه‌ها را بسازد یا تغییر دهد.",
  readOnlyNoteOnline: "فقط مدیر یا مسئول صندوق می‌تواند گروه‌ها را بسازد یا تغییر دهد.",
  invalidTitle: "گروه‌های تسویه مشکل دارند",
  invalidFixEditor: "تا اصلاح نشوند، تسویه به‌صورت تک‌تک نمایش داده می‌شود. لطفاً گروه‌ها را ویرایش و اصلاح کنید.",
  invalidFixReader: "تا اصلاح نشوند، تسویه به‌صورت تک‌تک نمایش داده می‌شود. از مدیر یا مسئول صندوق بخواهید گروه‌ها را اصلاح کند.",
  representative: "نماینده",
  newTitle: "گروه جدید",
  editTitle: "ویرایش گروه",
  nameLabel: "نام گروه",
  namePlaceholder: "مثلاً خانواده‌ی احمدی",
  membersLabel: "اعضا",
  membersHint: "روی نام هر نفر بزنید تا به گروه اضافه یا از آن کم شود (نام‌های پررنگ عضو گروه‌اند).",
  noPeople: "هنوز عضو فعالی در این رویداد نیست.",
  representativeLabel: "نماینده‌ی گروه",
  representativePick: "یک نفر از اعضای گروه را به‌عنوان نماینده انتخاب کنید.",
  treasurerLock: (name: string) => `«${name}» مسئول صندوق است؛ پس نماینده‌ی این گروه باید خودش باشد.`,
  save: "ذخیره",
  create: "ایجاد گروه",
  cancel: "انصراف",
  delete: "حذف گروه",
  deleteTitle: "حذف گروه",
  deleteMessage: (name: string) => `گروه «${name}» حذف شود؟ فقط گروه حذف می‌شود؛ تراز و سابقه‌ی هیچ‌کس تغییر نمی‌کند.`,
  deleteConfirm: "حذف",
  inOtherGroup: (name: string) => `در گروه «${name}» است`,
  genericSaveError: "ذخیره انجام نشد. دوباره تلاش کنید.",
  genericDeleteError: "حذف انجام نشد. دوباره تلاش کنید.",
  membersCount: (n: string) => `${n} نفر`
} as const;

export const SG_HELP = {
  section: {
    title: "گروه تسویه چیست؟",
    body: "برای مثال زوج یا خانواده؛ بدهی و طلب اعضا با هم جمع می‌شود و تسویه از طریق یک نماینده انجام می‌شود؛ تراز فردی هر نفر تغییر نمی‌کند."
  },
  representative: {
    title: "نماینده کیست؟",
    body: "نماینده کسی است که پولِ کل گروه از طریق او پرداخت یا دریافت می‌شود؛ مثلاً در یک خانواده یکی از والدین. فقط یک نفر نماینده است و باید عضو گروه باشد."
  },
  treasurerLock: {
    title: "چرا نماینده قفل است؟",
    body: "مسئول صندوق پول رویداد را جمع و پخش می‌کند. اگر او عضو یک گروه باشد، پول گروه هم باید از طریق خودش برود؛ برای همین نماینده عوض نمی‌شود. اگر می‌خواهید نماینده‌ی دیگری داشته باشید، اول مسئول صندوق رویداد را عوض کنید."
  }
} as const;

export const DRAFT_ERROR_MESSAGES: Record<DraftErrorCode, string> = {
  "empty-name": "نام گروه را وارد کنید.",
  "too-few-members": "هر گروه باید حداقل ۲ عضو داشته باشد.",
  "duplicate-member": "یک نفر نباید دو بار در گروه باشد.",
  "unknown-person": "یکی از اعضا دیگر عضو این رویداد نیست.",
  "representative-not-member": "نماینده باید یکی از اعضای گروه باشد.",
  "person-in-multiple-groups": "هر نفر فقط در یک گروه می‌تواند باشد.",
  "treasurer-must-represent": "مسئول صندوق باید نماینده‌ی گروهی باشد که در آن است.",
  "no-representative": "یک نماینده انتخاب کنید."
};

/** Deactivation texts (SG-3). */
export const SG_DEACTIVATE = {
  inGroup: (groupName: string) => `این نفر عضو گروه «${groupName}» است؛ از گروه خارج می‌شود.`,
  blockedTitle: "خارج کردن ممکن نیست",
  blockedMessage: (groupName: string) =>
    `نمی‌شود این نفر را از گروه «${groupName}» خارج کرد، چون مسئول صندوق باید نماینده‌ی گروه خودش باشد. اول نماینده‌ی گروه یا مسئول صندوق رویداد را عوض کنید، بعد دوباره امتحان کنید.`,
  blockedOther: "خارج کردن این نفر از گروه ممکن نشد. اطلاعات تغییری نکرد.",
  understood: "متوجه شدم"
} as const;
