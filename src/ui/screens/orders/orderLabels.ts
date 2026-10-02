import type { ExtraAllocation, OrderSessionStatus, SessionExtraKind } from "@/data/types";

export const SESSION_STATUS_LABELS: Record<OrderSessionStatus, string> = {
  draft: "پیش‌نویس",
  open: "در حال ثبت سفارش",
  locked: "سفارش داده شد",
  pricing: "قیمت‌گذاری",
  finalized: "نهایی‌شده",
  cancelled: "لغوشده"
};

export const ALLOCATION_LABELS: Record<ExtraAllocation, string> = {
  proportional: "متناسب با سفارش",
  equal: "مساوی",
  weight: "با ضریب"
};

export const EXTRA_KIND_OPTIONS: SessionExtraKind[] = ["vat", "service", "tip", "discount", "other"];
