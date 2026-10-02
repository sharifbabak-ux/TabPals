/**
 * The short Persian summary text sent alongside a statement link
 * (docs/PLAN.md Stage 3C send menu / SMS size policy): a greeting with the
 * member's first name, the event title, the final balance line, the
 * treasurer's name, payment details for a debtor, and the link (or, when
 * no link fits, a line asking the recipient to contact the treasurer).
 */
import { buildBalanceText } from "./messageTemplate";

export interface StatementSummaryParams {
  firstName: string;
  eventTitle: string;
  balance: number;
  currency: string;
  treasurerName: string | null;
  treasurerCardNumberGrouped?: string | null;
  treasurerIbanGrouped?: string | null;
  /** The statement link URL, or null when it doesn't fit the SMS size budget (see statementLink.ts). */
  link: string | null;
}

export const NO_LINK_CONTACT_TREASURER_LINE = "برای دریافت صورت‌حساب کامل با مسئول صندوق در تماس باشید";

export function buildStatementSummaryText(params: StatementSummaryParams): string {
  const lines = [`سلام ${params.firstName}،`, `صورت‌حساب رویداد «${params.eventTitle}» آماده است.`, buildBalanceText(params.balance, params.currency)];

  if (params.treasurerName) {
    lines.push(`مسئول صندوق: ${params.treasurerName}`);
  }

  if (params.balance < 0) {
    if (params.treasurerCardNumberGrouped) lines.push(`شماره کارت: ${params.treasurerCardNumberGrouped}`);
    if (params.treasurerIbanGrouped) lines.push(`شبا: ${params.treasurerIbanGrouped}`);
  }

  lines.push(params.link ?? NO_LINK_CONTACT_TREASURER_LINE);

  return lines.join("\n");
}
