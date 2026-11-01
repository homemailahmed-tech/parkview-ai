import type { ExtractedEnquiry, ExtractionCheck } from "./extraction";
import type { OpenQuestion, QuestionTopic } from "../domain/types";

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
export function openQuestionsFrom(check: ExtractionCheck, message: string): OpenQuestion[] {
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
  // Ages the AI inferred (children without the guest saying so) block allocation until confirmed.
  const ageOpen = out.some((q) => q.topic === "ages");
  if (ageOpen && aiChildren) for (const q of out) if (q.topic === "ages") q.blocksAllocation = true;
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
