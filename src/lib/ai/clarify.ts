import type { ClarifyInput } from "./types";

/**
 * Clarification replies: when the enquiry is incomplete or contradictory, the app drafts a
 * WhatsApp question for the guest instead of guessing. The model may only ask; it may never
 * state prices, availability or confirmations. Anything that does is replaced by this template.
 */

/** Turns staff-facing "missing" notes into guest-facing questions (deterministic). */
export function guestQuestions(missing: string[]): string[] {
  const out: string[] = [];
  let arrival = false, nights = false, exactDates = false;
  for (const m of missing) {
    const s = m.trim();
    let q: string | undefined;
    if (/^to clarify: /i.test(s)) q = s.replace(/^to clarify: /i, "");
    else if (/check-in date/i.test(s)) arrival = true;
    else if (/check-out|number of nights/i.test(s)) nights = true;
    else if (/^dates/i.test(s)) exactDates = true;
    else if (/guest count|total number of adults|number of adults/i.test(s)) q = "How many people will be staying in total, including drivers, coaches or helpers?";
    else if (/accompanying adult/i.test(s)) q = "How many adults will be travelling with the children?";
    else q = s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith("?") ? "" : "?");
    if (q && !out.includes(q)) out.push(q);
  }
  // One date question instead of several overlapping ones.
  if (exactDates || (arrival && nights)) out.unshift("Could you please confirm your exact arrival date and how many nights you will stay?");
  else if (arrival) out.unshift("Which date would you like to arrive?");
  else if (nights) out.unshift("How many nights would you like to stay?");
  return out.slice(0, 6);
}

export function clarificationTemplate(input: ClarifyInput): string {
  const qs = input.questions.length ? input.questions : ["Could you please share your dates and the number of guests?"];
  return [
    `Hi ${input.guestName}, thank you for your message to ${input.propertyName}!`,
    "To prepare an accurate quote, could you please confirm:",
    ...qs.map((q, i) => `${i + 1}. ${q}`),
    "Thank you!",
  ].join("\n");
}

/** Wording a clarification must never contain: prices, availability or booking promises. */
export function violatesClarificationRules(text: string): string | undefined {
  if (/(\bR\s?\d|\bZAR\b|\$|€|£|\bper night\b|\bdiscount|\bdeposit\b|\bprice[sd]?\b|\btotal of\b)/i.test(text)) return "mentions prices";
  if (/(\b(rooms?|space|beds?) (is|are) (still )?(available|free|open)\b|\bwe (do )?have (space|rooms?|availability)\b|\bavailable for you\b|\b(is|are|been) (confirmed|reserved|booked)\b|\bconfirmed your\b|\bguarantee)/i.test(text))
    return "promises availability or a booking";
  if (text.length > 900) return "too long";
  return undefined;
}
