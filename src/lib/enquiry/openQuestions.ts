import type { ExtractedEnquiry, ExtractionCheck } from "./extraction";
import type { Actor, Enquiry, GuestUnit, OpenQuestion, QuestionTopic, StayRequest, WorkflowEvent } from "../domain/types";
import { EXCLUSIVE_QUESTION_PREFIX, packageFromAnswer } from "./exclusiveUse";

export type { OpenQuestion, QuestionTopic };

/**
 * Open questions: facts the guest has not confirmed. While any are open the booking is
 * PROVISIONAL — rooms may be explored and a draft quote prepared, but the owner cannot approve,
 * send or confirm it (enforced in the workflow). Ages inferred by the AI (e.g. "girls" taken as
 * children) also block room allocation, because who sleeps where depends on them.
 */

const TOPIC_RULES: [QuestionTopic, RegExp][] = [
  ["ages", /\b(child|children|kids?|minors?|adults?|ages?|aged|under-?\s?\d+|u\d{2}|years? old|older|younger|teen\w*)\b/i],
  ["count", /(how many|in total|\btotal\b|included|\bextra\b|\d+(st|nd|rd|th) guest|guest count|number of (people|guests|adults)|head-?count)/i],
  ["dates", /(dates?\b|nights?\b|check-?in|check-?out|arriv|depart|\bstay(ing)?\b|friday|saturday|sunday|weekend|week\b)/i],
  ["access", /(stairs?|wheelchair|ground[- ]floor|accessib|mobility|crutch|walk)/i],
  ["preference", /(own rooms?|share|sharing|separate beds?|\bbeds?\b|privacy|prefer|together|quiet)/i],
];

export function topicOf(text: string): QuestionTopic {
  for (const [topic, re] of TOPIC_RULES) if (re.test(text)) return topic;
  return "other";
}

const ROLE_WORDS = /\b(girls?|boys?|players?|learners?|pupils?|students?|team|squad|members?|scholars?|meisies|seuns|spelers)\b/i;
const EXPLICIT_AGE = /\b(adults?|children|kids?|grown-?ups?|under-?\s?\d+|u\d{2}\b|aged?\s?\d+|\d+\s?years? old|volwassenes?|kinders?|abantwana|abadala)\b/i;

/**
 * Deterministic: the message describes people by role ("12 netball girls", "the team") without
 * saying whether they are adults or children. Any age the AI assigned to them is an inference.
 */
export function agesUnstated(message: string): boolean {
  return ROLE_WORDS.test(message) && !EXPLICIT_AGE.test(message);
}

/** Builds the open questions for an interpreted enquiry (deterministic notes + the AI's clarifications). */
export function openQuestionsFrom(check: ExtractionCheck, message: string, units: GuestUnit[] = []): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const add = (q: OpenQuestion) => {
    const key = q.text.toLowerCase();
    if (!out.some((o) => o.text.toLowerCase() === key)) out.push(q);
  };
  for (const m of check.missing) {
    const text = m.replace(/^to clarify: /i, "").trim();
    add({ topic: topicOf(m.startsWith("guest count") || /total number of adults|number of adults/.test(m) ? "how many in total" : text), text });
  }
  const v: ExtractedEnquiry = check.value;
  const aiChildren = (v.children ?? 0) > 0;
  if (agesUnstated(message)) {
    add({ topic: "ages", text: "Ages not stated by the guest: confirm who is an adult and who is a child before allocating rooms" });
  }
  // Ages the guest did not state (or the AI inferred) block allocation until confirmed.
  const ageOpen = out.some((q) => q.topic === "ages");
  if (ageOpen && (aiChildren || agesUnstated(message))) for (const q of out) if (q.topic === "ages") q.blocksAllocation = true;
  // Access needs: with several parties the app cannot know WHICH party contains the guest who
  // needs a wheelchair / no stairs. It assigns the need to one party; staff must confirm who.
  const needy = units.filter((u) => u.access !== "none");
  if (units.length > 1 && ((v.wheelchairUsers ?? 0) > 0 || (v.groundFloorGuests ?? 0) > 0)) {
    const need = (v.wheelchairUsers ?? 0) > 0 ? "uses a wheelchair" : "cannot use stairs";
    add({ topic: "access", text: `Which guest ${need}? The app assigned this need to ${needy.map((u) => u.label).join(", ") || "no party"} — confirm, or move it in the guest parties` });
  }
  return mergeByTopic(out);
}

/** One staff item per topic (dates, count, ages, access): related notes are joined, not repeated. */
function mergeByTopic(qs: OpenQuestion[]): OpenQuestion[] {
  const merged: OpenQuestion[] = [];
  for (const q of qs) {
    const same = q.topic === "preference" || q.topic === "other" || q.topic === "requirement" ? undefined : merged.find((m) => m.topic === q.topic);
    if (same) {
      same.text = `${same.text} · ${q.text}`;
      same.blocksAllocation = same.blocksAllocation || q.blocksAllocation;
    } else merged.push({ ...q });
  }
  return merged;
}

const PRIORITY: QuestionTopic[] = ["dates", "count", "ages", "access", "requirement", "other", "preference"];

/**
 * Guest-facing questions: one per topic where possible (no duplicates), most important first,
 * at most 4. Preference questions are only asked when nothing more important is open.
 */
export function guestQuestionsFrom(questions: OpenQuestion[]): string[] {
  const critical = questions.some((q) => q.topic !== "preference");
  const byTopic = new Map<QuestionTopic, string[]>();
  for (const q of questions) {
    if (q.topic === "preference" && critical) continue;
    byTopic.set(q.topic, [...(byTopic.get(q.topic) ?? []), q.text]);
  }
  const out: string[] = [];
  for (const t of PRIORITY) {
    const qs = byTopic.get(t);
    if (!qs) continue;
    out.push(...guestWording(t, qs));
  }
  return out.slice(0, 4);
}

function guestWording(topic: QuestionTopic, texts: string[]): string[] {
  switch (topic) {
    case "dates":
      return ["Could you please confirm your exact arrival date and how many nights you will stay?"];
    case "count": {
      const specific = texts.find((t) => /\?$/.test(t) && !/^guest count|^confirmed total/i.test(t));
      return [specific ?? "How many people will be staying in total, including drivers, coaches or helpers?"];
    }
    case "ages":
      return ["How many of the group are adults, and how many are children (under 18)?"];
    default:
      return texts.map((t) => (/\?$/.test(t) ? t : `${t.charAt(0).toUpperCase()}${t.slice(1)}?`)).slice(0, 1);
  }
}

export const CONFIRMATION_SOURCES = ["whatsapp", "phone", "email", "in-person"] as const;
export type ConfirmationSource = (typeof CONFIRMATION_SOURCES)[number];

export interface QuestionResolution {
  /** The open question's text, exactly as listed. */
  question: string;
  /** What the guest actually confirmed, e.g. "Gogo is the 17th guest". */
  answer: string;
  source: ConfirmationSource;
  /** Staff member who received the answer. */
  confirmedBy: string;
}

export class ResolutionError extends Error {}

/**
 * Records guest-confirmed answers. A question is only closed with the guest's actual answer,
 * where it came from and who received it — never by a bare checkbox. Each answer is written to
 * the audit trail. Unanswered questions stay open (and the booking stays provisional).
 */
export function resolveOpenQuestions(enquiry: Enquiry, resolutions: QuestionResolution[], actor: Actor, now: string): Enquiry {
  const open = enquiry.openQuestions ?? [];
  if (!resolutions.length) throw new ResolutionError("Enter the guest's answer to at least one question");
  const events: WorkflowEvent[] = [];
  const closed = new Set<string>();
  let request: StayRequest | undefined = enquiry.request;
  for (const r of resolutions) {
    const q = open.find((o) => o.text === r.question);
    if (!q) throw new ResolutionError(`Not an open question: ${r.question}`);
    const answer = (r.answer ?? "").trim();
    const by = (r.confirmedBy ?? "").trim();
    if (answer.length < 2) throw new ResolutionError(`Enter the guest's actual answer for: ${q.text}`);
    if (!CONFIRMATION_SOURCES.includes(r.source)) throw new ResolutionError("Choose where the answer came from (WhatsApp, phone, email or in person)");
    if (by.length < 2) throw new ResolutionError("Enter who received the guest's answer");
    // A head-count answer must state the total, and the guest parties must already match it.
    const partyTotal = (enquiry.request?.units ?? []).reduce((s, u) => s + u.adults + u.children, 0);
    if (q.topic === "count") {
      const nums = [...answer.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)?\b/gi)].map((m) => Number(m[1])); // "17" or "17th"
      if (!nums.length) throw new ResolutionError(`Include the confirmed total number of guests in the answer to: ${q.text}`);
      if (!nums.includes(partyTotal)) throw new ResolutionError(`The guest's answer (${nums.join(", ")}) does not match the guest parties (${partyTotal} people). Update the parties first.`);
    }
    if (q.topic === "ages" && /\b(all|only)\b.*\badults?\b|\bno (children|kids)\b/i.test(answer)) {
      const kids = (enquiry.request?.units ?? []).reduce((s, u) => s + u.children, 0);
      if (kids > 0) throw new ResolutionError(`The guest says all are adults, but the guest parties include ${kids} child(ren). Update the parties first.`);
    }
    if (q.text.startsWith(EXCLUSIVE_QUESTION_PREFIX)) {
      const pkg = packageFromAnswer(answer);
      if (!pkg) throw new ResolutionError("Record which option the guest chose: Main House, Whole Property, or not exclusive (separate rooms)");
      if (request) request = { ...request, exclusiveUse: pkg === "none" ? undefined : pkg };
    }
    closed.add(q.text);
    events.push({ at: now, actor, action: "resolve_question", from: enquiry.status, to: enquiry.status, note: `[${q.topic}] ${q.text} → guest confirmed: "${answer.slice(0, 200)}" (via ${r.source}, recorded by ${by.slice(0, 60)})` });
  }
  return {
    ...enquiry,
    request,
    openQuestions: open.filter((o) => !closed.has(o.text)),
    resolvedQuestions: [...(enquiry.resolvedQuestions ?? []), ...resolutions.map((r) => ({ ...r, answer: r.answer.trim().slice(0, 200), confirmedBy: r.confirmedBy.trim().slice(0, 60), at: now, topic: open.find((o) => o.text === r.question)!.topic }))],
    events: [...enquiry.events, ...events],
  };
}
