import type { Property, Quote } from "../domain/types";
import { formatDate } from "../domain/dates";
import { formatMoney } from "../domain/money";

/**
 * Plain-text quotation suitable for pasting into WhatsApp or email.
 * Figures come only from the validated quote object.
 */
export function formatQuoteText(quote: Quote, property: Property, opts: { intro?: string } = {}): string {
  const m = (n: number) => formatMoney(n, property.currencySymbol);
  const lines: string[] = [];
  lines.push(`*${property.name} — Quotation ${quote.id}*`);
  lines.push("");
  if (opts.intro?.trim()) {
    lines.push(opts.intro.trim());
    lines.push("");
  } else {
    lines.push(`Dear ${quote.guestName},`);
    lines.push("Thank you for your enquiry. Please find your quotation below.");
    lines.push("");
  }
  lines.push(`📅 Check-in: ${formatDate(quote.checkIn)} (from ${property.checkInTime})`);
  lines.push(`📅 Check-out: ${formatDate(quote.checkOut)} (by ${property.checkOutTime})`);
  lines.push(`🌙 ${quote.nights} night${quote.nights === 1 ? "" : "s"}`);
  lines.push("");
  for (const l of quote.lines) {
    lines.push(`• ${l.description} — ${l.guests} guest${l.guests === 1 ? "" : "s"}: ${m(l.nightlyRate)} × ${l.nights} = ${m(l.total)}`);
  }
  lines.push("");
  lines.push(`Subtotal: ${m(quote.subtotal)}`);
  if (quote.discount > 0) lines.push(`Group discount (${quote.discountPercent}%): -${m(quote.discount)}`);
  lines.push(`*Total: ${m(quote.total)}*`);
  lines.push(`Deposit to secure booking (${property.depositPercent}%): ${m(quote.deposit)}`);
  if (quote.notes.trim()) {
    lines.push("");
    lines.push(quote.notes.trim());
  }
  lines.push("");
  lines.push("This quotation is subject to availability until the deposit is received.");
  lines.push("_Demo quotation — fictional property and rates._");
  return lines.join("\n");
}
