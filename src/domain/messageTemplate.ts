/**
 * Closing-message template selection and rendering for statements
 * (docs/PLAN.md Stage 3B). Selection happens once at issue time and the
 * chosen template id + rendered text are stored on the Statement, so
 * re-opening/re-sending never changes them (see statementBuilder.ts).
 */
import type { MessageTemplateCategory } from "@/data/types";
import { formatAmount } from "./format";

export interface TemplateCandidate {
  id: string;
  category: MessageTemplateCategory;
  text: string;
  enabled: boolean;
}

/** Random among enabled templates of the given category. `random` is injectable for deterministic tests. */
export function pickTemplate(
  templates: TemplateCandidate[],
  category: MessageTemplateCategory,
  random: () => number = Math.random
): TemplateCandidate | null {
  const eligible = templates.filter((t) => t.category === category && t.enabled);
  if (eligible.length === 0) return null;
  const index = Math.min(Math.floor(random() * eligible.length), eligible.length - 1);
  return eligible[index];
}

/** A statement's closing-message category: the treasurer's own statement always uses "treasurer"; everyone else's depends on their final balance. */
export function categoryForStatement(kind: "member" | "treasurer", balance: number): MessageTemplateCategory {
  if (kind === "treasurer") return "treasurer";
  if (balance < 0) return "debtor";
  if (balance > 0) return "creditor";
  return "settled";
}

/** The final-balance line: "{amount} {currency} بدهکار به صندوق" / "بستانکار از صندوق" / "حساب شما صاف است". Used both standalone and as the {balanceText} placeholder. */
export function buildBalanceText(balance: number, currency: string): string {
  if (balance < 0) return `${formatAmount(-balance)} ${currency} بدهکار به صندوق`;
  if (balance > 0) return `${formatAmount(balance)} ${currency} بستانکار از صندوق`;
  return "حساب شما صاف است";
}

export interface TemplatePlaceholders {
  name: string;
  amount: string;
  currency: string;
  treasurer: string;
  event: string;
  balanceText: string;
}

const PLACEHOLDER_PATTERN = /\{(name|amount|currency|treasurer|event|balanceText)\}/g;

/** Fills {name} {amount} {currency} {treasurer} {event} {balanceText} placeholders in a template's text. */
export function fillTemplate(text: string, placeholders: TemplatePlaceholders): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, key: keyof TemplatePlaceholders) => placeholders[key]);
}
