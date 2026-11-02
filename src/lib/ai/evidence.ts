import type { GuestUnit, ISODate } from "../domain/types";
import type { ExtractedEnquiry } from "../enquiry/extraction";
import type { OpenQuestion, QuestionTopic } from "../enquiry/openQuestions";

/**
 * EVIDENCE TRAIL — "show me where it says that".
 *
 * For each booking fact the app is about to use (including facts the APP derived, e.g. a guest total
 * computed from couples), Muse Spark is asked to copy the exact words in the guest's message that state
 * it. This module then checks every citation DETERMINISTICALLY:
 *   1. the quote must occur verbatim in the message (after whitespace/case/quote-mark normalisation);
 *      quotes that do not occur are discarded and never shown;
 *   2. numbers: the fact's value must appear in the quoted words (digits or English/Afrikaans number
 *      words); several numbers, corrections and negations are handled conservatively;
 *   3. dates: the quoted words must contain the day and the month; relative or derived dates stay uncertain;
 *   4. while a head-count question is open, head-count facts are never shown as confirmed.
 *
 * LIMITS (stated in the UI): this proves the quoted words exist and contain the number. It does not prove
 * the model understood the meaning — a matching quote can still be the wrong evidence.
 */

export type FactKind = "date" | "count" | "flag";
export type FactKey =
  | "checkIn" | "checkOut" | "nights" | "totalGuests" | "adults" | "children" | "couples"
  | "privateRoom" | "accessNeed" | "selfCatering" | "separateBeds";

export interface EvidenceFact {
  key: FactKey;
  label: string;
  kind: FactKind;
  value: number | boolean | ISODate;
  /** Informational only: "app" = computed by the app (guest total, own rooms); "ai" = taken from the reading of the message. Not shown as a claim. */
  origin: "ai" | "app";
}

export type Verdict = "supported" | "uncertain" | "conflict" | "unsupported";

export interface EvidenceItem {
  fact: EvidenceFact;
  verdict: Verdict;
  /** Deterministic explanation (never model text). */
  reason: string;
  /** The verified quote (verbatim slice of the original message) — absent if none or discarded. */
  quote?: string;
  span?: [number, number];
}

export interface EvidenceReport {
  items: EvidenceItem[];
  /** Quotes the model gave that are NOT in the message — discarded, never displayed. */
  discarded: number;
  counts: Record<Verdict, number>;
}

const HEADCOUNT: FactKey[] = ["totalGuests", "adults", "children"];

/** Builds the facts to check from the guest parties the app will allocate plus the AI's extracted fields. */
export function evidenceFacts(request: { checkIn?: string; checkOut?: string; units: GuestUnit[]; selfCatering?: boolean }, ai: ExtractedEnquiry = {}): EvidenceFact[] {
  const f: EvidenceFact[] = [];
  const u = request.units ?? [];
  const sum = (g: (x: GuestUnit) => number) => u.reduce((s, x) => s + g(x), 0);
  if (request.checkIn) f.push({ key: "checkIn", label: "Check-in", kind: "date", value: request.checkIn, origin: ai.checkIn === request.checkIn ? "ai" : "app" });
  if (request.checkOut) f.push({ key: "checkOut", label: "Check-out", kind: "date", value: request.checkOut, origin: ai.checkOut === request.checkOut ? "ai" : "app" });
  if (request.checkIn && request.checkOut) {
    const nights = Math.round((Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000);
    if (nights > 0) f.push({ key: "nights", label: "Nights", kind: "count", value: nights, origin: ai.nights === nights ? "ai" : "app" });
  }
  if (u.length) {
    const total = sum((x) => x.adults + x.children), adults = sum((x) => x.adults), children = sum((x) => x.children);
    f.push({ key: "totalGuests", label: "Guests in the parties", kind: "count", value: total, origin: "app" });
    f.push({ key: "adults", label: "Adults", kind: "count", value: adults, origin: ai.adults === adults ? "ai" : "app" });
    if (children > 0 || ai.children !== undefined) f.push({ key: "children", label: "Children", kind: "count", value: children, origin: ai.children === children ? "ai" : "app" });
    const couples = sum((x) => x.couples);
    // Couples and separate beds are only checked when the reading of the message states them; the app's own
    // defaults (e.g. parents in a family share a bed) are not guest facts.
    if (couples > 0 && ai.couples !== undefined) f.push({ key: "couples", label: "Couples sharing a bed", kind: "count", value: couples, origin: ai.couples === couples ? "ai" : "app" });
    const own = u.filter((x) => x.privateRoom).length;
    if (own > 0) f.push({ key: "privateRoom", label: "Own room (driver / leader)", kind: "count", value: own, origin: "app" });
  }
  const access = (ai.wheelchairUsers ?? 0) + (ai.groundFloorGuests ?? 0) || u.filter((x) => x.access !== "none").length;
  if (access > 0) f.push({ key: "accessNeed", label: "Needs ground floor / no stairs", kind: "count", value: access, origin: ai.wheelchairUsers || ai.groundFloorGuests ? "ai" : "app" });
  if (request.selfCatering ?? ai.selfCatering) f.push({ key: "selfCatering", label: "Self-catering", kind: "flag", value: true, origin: ai.selfCatering ? "ai" : "app" });
  if (ai.separateBeds) f.push({ key: "separateBeds", label: "Separate beds", kind: "flag", value: true, origin: "ai" });
  return f;
}

/** System prompt for the evidence call. The model only locates words; code decides. */
export function evidencePrompt(): string {
  return [
    "You find EVIDENCE for booking facts in a guest's WhatsApp message. You do not judge or change the facts.",
    "For EACH fact, copy the exact words from the message that state it: verbatim, same spelling and language (do not translate), the shortest span that states the fact, at most 14 words.",
    "If the message does not state the fact (for example a number the guest never wrote), use quote null and status \"not_stated\". Never invent, paraphrase or join words from different places.",
    "status: \"stated\" | \"corrected\" (the guest changed it and this is the latest value; quote the words containing the change) | \"not_stated\" | \"contradicted\" (the message says something different; quote those words).",
    "Reply with ONE JSON object only: {\"evidence\": [{\"key\": string, \"quote\": string | null, \"status\": string}]}",
  ].join("\n");
}

export function evidenceUserText(message: string, facts: EvidenceFact[]): string {
  return [
    "MESSAGE:", message, "",
    "FACTS:", JSON.stringify(facts.map((f) => ({ key: f.key, fact: f.label, value: f.value }))),
  ].join("\n");
}

// ---------- normalisation and matching ----------

const QUOTES: Record<string, string> = { "‘": "'", "’": "'", "‛": "'", "`": "'", "“": "\"", "”": "\"", "–": "-", "—": "-", " ": " " };

/** Normalised text plus a map from each normalised index to the original index. */
function normalise(s: string): { text: string; map: number[] } {
  const src = s.normalize("NFC");
  let text = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < src.length; i++) {
    let c = QUOTES[src[i]] ?? src[i];
    if (/\s/.test(c)) {
      if (lastSpace) continue;
      c = " ";
      lastSpace = true;
    } else {
      const lower = c.toLowerCase();
      if (lower.length === 1) c = lower;
      lastSpace = false;
    }
    text += c;
    map.push(i);
  }
  return { text: text.trimEnd(), map };
}

/** Finds `quote` verbatim (normalised) in `message`; returns the span in the ORIGINAL message. */
export function locateQuote(message: string, quote: string): [number, number] | undefined {
  const q = normalise(quote.trim().replace(/^["'“‘]+|["'”’]+$/g, "").replace(/(\.\.\.|…)$/, "")).text.trim();
  if (q.length < 2) return undefined;
  const m = normalise(message.normalize("NFC"));
  const at = m.text.indexOf(q);
  if (at < 0) return undefined;
  return [m.map[at], m.map[at + q.length - 1] + 1];
}

// ---------- numbers, dates and cues ----------

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  een: 1, twee: 2, drie: 3, vier: 4, vyf: 5, ses: 6, sewe: 7, agt: 8, nege: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14,
  vyftien: 15, sestien: 16, sewentien: 17, agtien: 18, negentien: 19, twintig: 20, dertig: 30, veertig: 40, vyftig: 50,
};
const NEGATION = new Set(["not", "no", "never", "nie", "geen", "nooit", "without", "sonder", "don't", "dont", "isn't", "aren't", "won't"]);
const CORRECTION_BEFORE = /\b(now|nou|actually|eintlik|make it|change (it )?to|updated?|rather)\s*$/;
const CORRECTION_AFTER = /^\s*(\S+\s+)?(instead|in plaas)\b/;
const MONTHS: [RegExp, number][] = [
  [/^(jan|januarie|january)$/, 1], [/^(feb|februarie|february)$/, 2], [/^(mar|maart|march)$/, 3], [/^(apr|april)$/, 4], [/^(mei|may)$/, 5],
  [/^(jun|junie|june)$/, 6], [/^(jul|julie|july)$/, 7], [/^(aug|augustus|august)$/, 8], [/^(sep|sept|september)$/, 9],
  [/^(okt|oct|oktober|october)$/, 10], [/^(nov|november)$/, 11], [/^(des|dec|desember|december)$/, 12],
];
const RELATIVE = /\b(next|after next|tomorrow|this weekend|tonight|volgende|oormôre|môreaand|vandag|today)\b/;
const DURATION = /\b(week|weeks|weke|nights?|nagte|aande|days?|dae|weekend)\b/;

interface Num { value: number; at: number }

/** Tokenises a normalised quote and returns the numbers in it with their token positions. */
function numbersIn(text: string): { tokens: string[]; nums: Num[] } {
  const tokens = text.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean);
  const nums: Num[] = [];
  tokens.forEach((t, i) => {
    const d = /^(\d{1,4})(st|nd|rd|th|de|ste)?$/.exec(t);
    if (d) nums.push({ value: Number(d[1]), at: i });
    else if (WORDS[t] !== undefined) nums.push({ value: WORDS[t], at: i });
  });
  return { tokens, nums };
}

function negatedAt(tokens: string[], at: number): boolean {
  for (let i = Math.max(0, at - 2); i < at; i++) if (NEGATION.has(tokens[i])) return true;
  return false;
}

/** The latest corrected value in a quote ("not 14 anymore, now 16", "3 nights instead of 2", "make it 3"), if any. */
function correctedValue(tokens: string[], nums: Num[]): number | undefined {
  let out: number | undefined;
  for (const n of nums) {
    const before = tokens.slice(Math.max(0, n.at - 3), n.at).join(" ");
    const after = tokens.slice(n.at + 1, n.at + 4).join(" ");
    if (CORRECTION_BEFORE.test(before) || CORRECTION_AFTER.test(after)) out = n.value;
  }
  return out;
}

const MESSAGE_CORRECTION = /\b(not|no longer|nie)\b[^.!?]{0,40}\d+[^.!?]{0,40}\b(now|nou|instead|in plaas)\b|\binstead of \d+|\bchange of plans?\b/i;

const ADDITIVE = /(\b(plus|and|en|ook|too|also|with|met)\b|\+)/;

function checkCount(fact: EvidenceFact, text: string, tokens: string[], nums: Num[]): { verdict: Verdict; reason: string } {
  const v = fact.value as number;
  if (fact.key === "nights" && !nums.length && /(^|\s)('n|a|one|een) week\b/.test(text))
    return v === 7 ? { verdict: "uncertain", reason: "The guest wrote “a week”; read as 7 nights — confirm" } : { verdict: "conflict", reason: `The guest wrote “a week”, not ${v} nights` };
  if (!nums.length) {
    if (v === 1 && (fact.key === "accessNeed" || fact.key === "privateRoom")) return { verdict: "supported", reason: "The quoted words refer to one person" };
    return { verdict: "unsupported", reason: `The quoted words contain no number — nothing states ${v}` };
  }
  const distinct = [...new Set(nums.map((n) => n.value))];
  const latest = correctedValue(tokens, nums);
  const hits = nums.filter((n) => n.value === v);
  if (hits.length) {
    if (hits.every((h) => negatedAt(tokens, h.at))) return { verdict: "conflict", reason: `The guest says “not ${v}”` };
    if (distinct.length > 1) {
      if (latest === v) return { verdict: "supported", reason: `Corrected by the guest to ${v} (the later value)` };
      if (latest !== undefined) return { verdict: "conflict", reason: `The guest corrected this to ${latest}, not ${v}` };
      return { verdict: "uncertain", reason: `The quoted words contain several numbers (${distinct.join(", ")}) — confirm which applies` };
    }
    return { verdict: "supported", reason: `The guest's words state ${v}` };
  }
  // The value is not in the quoted words.
  const said = distinct.join(", ");
  if (fact.key === "totalGuests" && v < Math.max(...distinct)) return { verdict: "conflict", reason: `The guest's words mention ${latest ?? Math.max(...distinct)} people — the parties hold only ${v}` };
  const stated = latest ?? (distinct.length === 1 ? distinct[0] : undefined);
  if (ADDITIVE.test(text) && stated === undefined) return { verdict: "uncertain", reason: `Not stated as ${v}: the app added it up from ${said} — confirm` };
  if (ADDITIVE.test(text) && v > (stated ?? 0)) return { verdict: "uncertain", reason: `Not stated as ${v}: the app added it up from ${said} and other people mentioned — confirm` };
  if (stated !== undefined && fact.key === "totalGuests") return { verdict: "conflict", reason: `The guest's words say ${stated} — not ${v}` };
  return { verdict: "unsupported", reason: `The guest's words say ${said} — not ${v}` };
}

function checkDate(fact: EvidenceFact, text: string, tokens: string[], nums: Num[]): { verdict: Verdict; reason: string } {
  const [, mm, dd] = String(fact.value).split("-").map(Number);
  const months = tokens.map((t) => MONTHS.find(([re]) => re.test(t))?.[1]).filter((x): x is number => x !== undefined);
  const days = nums.filter((n) => n.value >= 1 && n.value <= 31).map((n) => n.value);
  if (days.includes(dd) && months.includes(mm)) return { verdict: "supported", reason: "The guest's words state this day and month" };
  if (RELATIVE.test(text)) return { verdict: "uncertain", reason: "A relative date (“next…”); the app worked out the calendar date — confirm" };
  if (DURATION.test(text)) return { verdict: "uncertain", reason: "Worked out from the length of stay, not stated as a date — confirm" };
  if (months.length && days.length) return { verdict: "conflict", reason: "The guest's words give a different date" };
  return { verdict: "unsupported", reason: "The quoted words do not state this date" };
}

function checkFlag(fact: EvidenceFact, tokens: string[]): { verdict: Verdict; reason: string } {
  if (tokens.some((t) => NEGATION.has(t))) return { verdict: "conflict", reason: "The quoted words contain a negation — the guest may be saying the opposite" };
  return { verdict: "supported", reason: "The guest's words ask for this" };
}

const RANK: Record<Verdict, number> = { supported: 0, uncertain: 1, unsupported: 2, conflict: 3 };

/**
 * Checks the model's citations. Never trusts the model's own status as proof: a "stated" claim
 * must still pass the verbatim and value checks; a model "contradicted"/"not_stated" can only
 * make the verdict stricter.
 */
export function verifyEvidence(rawMessage: string, facts: EvidenceFact[], raw: unknown, opts: { countQuestionOpen?: boolean } = {}): EvidenceReport {
  const rows = (raw && typeof raw === "object" && Array.isArray((raw as { evidence?: unknown }).evidence) ? (raw as { evidence: unknown[] }).evidence : []) as Record<string, unknown>[];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) if (r && typeof r.key === "string" && !byKey.has(r.key)) byKey.set(r.key, r);
  const message = rawMessage.normalize("NFC");
  const messageCorrected = MESSAGE_CORRECTION.test(message);
  let discarded = 0;
  const items: EvidenceItem[] = facts.map((fact) => {
    const r = byKey.get(fact.key);
    const status = typeof r?.status === "string" ? r.status : "not_stated";
    const quote = typeof r?.quote === "string" && r.quote.length <= 240 ? r.quote : undefined;
    const span = quote ? locateQuote(message, quote) : undefined;
    if (quote && !span) discarded++;
    if (!span) {
      return { fact, verdict: "unsupported", reason: quote ? "The AI's quote is not in the message — discarded" : "No words in the message state this" };
    }
    const shown = message.slice(span[0], span[1]);
    const n = normalise(shown).text;
    const { tokens, nums } = numbersIn(n);
    let res = fact.kind === "date" ? checkDate(fact, n, tokens, nums) : fact.kind === "flag" ? checkFlag(fact, tokens) : checkCount(fact, n, tokens, nums);
    // Conservative overrides (can only make a verdict stricter).
    const stricter = (v: Verdict, reason: string) => { if (RANK[v] > RANK[res.verdict]) res = { verdict: v, reason }; };
    if (status === "contradicted") stricter("uncertain", "The AI itself reports the message says something different — confirm");
    if (HEADCOUNT.includes(fact.key)) {
      if (opts.countQuestionOpen) stricter("uncertain", "The head-count is still an open question with the guest");
      if (messageCorrected && correctedValue(tokens, nums) === undefined) stricter("uncertain", "The message contains a correction; these words are not the corrected part — confirm");
    }
    return { fact, verdict: res.verdict, reason: res.reason, quote: shown, span };
  });
  const counts: Record<Verdict, number> = { supported: 0, uncertain: 0, conflict: 0, unsupported: 0 };
  for (const i of items) counts[i.verdict]++;
  return { items, discarded, counts };
}

const TOPIC: Record<FactKey, QuestionTopic> = {
  checkIn: "dates", checkOut: "dates", nights: "dates", totalGuests: "count", adults: "count", children: "ages",
  couples: "other", privateRoom: "requirement", accessNeed: "access", selfCatering: "requirement", separateBeds: "preference",
};

/** Facts the guest's words contradict or do not state become open questions (the booking stays provisional). */
export function evidenceQuestions(report: EvidenceReport): OpenQuestion[] {
  return report.items
    .filter((i) => i.verdict === "conflict" || i.verdict === "unsupported")
    .map((i) => ({ topic: TOPIC[i.fact.key], text: `Evidence check — ${i.fact.label}: ${String(i.fact.value)}. ${i.reason}. Confirm with the guest` }));
}
