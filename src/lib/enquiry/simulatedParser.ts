import type { ISODate } from "../domain/types";
import { addDays, isValidISODate, toUTC } from "../domain/dates";
import type { ExtractedEnquiry } from "./extraction";

/**
 * SIMULATION ONLY — a rule-based stand-in for the Meta Llama enquiry
 * interpreter so the demo works without API credentials. It understands a
 * limited set of phrasings; the real Meta model is expected to do far better.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
const NUM = "(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()]);

const pad = (n: number) => String(n).padStart(2, "0");

/** Builds a date, rolling into next year if it would otherwise be in the past. */
function resolveDate(day: number, month: number, year: number | undefined, today: ISODate): ISODate | undefined {
  const ty = Number(today.slice(0, 4));
  let iso = `${year ?? ty}-${pad(month)}-${pad(day)}`;
  if (!isValidISODate(iso)) return undefined;
  if (year === undefined && toUTC(iso) < toUTC(today)) iso = `${ty + 1}-${pad(month)}-${pad(day)}`;
  return isValidISODate(iso) ? iso : undefined;
}

function parseDates(text: string, today: ISODate): { checkIn?: ISODate; checkOut?: ISODate; nights?: number } {
  const t = text.toLowerCase();
  const out: { checkIn?: ISODate; checkOut?: ISODate; nights?: number } = {};

  const nightsM = t.match(new RegExp(`${NUM}\\s+nights?`));
  if (nightsM) out.nights = toNum(nightsM[1]);

  // ISO dates
  const iso = [...t.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]).filter(isValidISODate);
  if (iso.length >= 2) return { ...out, checkIn: iso[0], checkOut: iso[1] };
  if (iso.length === 1) out.checkIn = iso[0];

  // "12-14 December", "12 to 14 Dec 2026"
  const range = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|until|till)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:\\s+(\\d{4}))?`));
  if (range) {
    const month = MONTHS[range[3]];
    const year = range[4] ? Number(range[4]) : undefined;
    const checkIn = resolveDate(Number(range[1]), month, year, today);
    const checkOut = checkIn ? resolveDate(Number(range[2]), month, year ?? Number(checkIn.slice(0, 4)), today) : undefined;
    return { ...out, checkIn, checkOut };
  }

  // "12 December", "Dec 12", "12th of December 2026" — first is check-in, second is check-out.
  const dates: ISODate[] = [];
  const re = new RegExp(`(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}|${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(\\d{4}))?`, "g");
  for (const m of t.matchAll(re)) {
    const day = Number(m[1] ?? m[4]);
    const month = MONTHS[m[2] ?? m[3]];
    const d = resolveDate(day, month, m[5] ? Number(m[5]) : undefined, today);
    if (d) dates.push(d);
  }
  if (!out.checkIn && dates[0]) out.checkIn = dates[0];
  if (dates[1]) out.checkOut = dates[1];
  if (out.checkIn && !out.checkOut && out.nights) out.checkOut = addDays(out.checkIn, out.nights);
  return out;
}

function count(t: string, nouns: string): number | undefined {
  const m = t.match(new RegExp(`${NUM}\\s+(?:\\w+\\s+)?(?:${nouns})\\b`));
  return m ? toNum(m[1]) : undefined;
}

export function simulateExtraction(text: string, today: ISODate): ExtractedEnquiry {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const ex: ExtractedEnquiry = { notes: [] };

  const name = text.match(/(?:my name is|this is|i am|i'm|regards,?|thanks,?|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (name && !/^(The|We|Our)$/.test(name[1])) ex.guestName = name[1];

  Object.assign(ex, parseDates(text, today));

  const adults = count(t, "adults?|grown-?ups|men|women|ladies|gentlemen|players|members|delegates|colleagues|staff|workers|students|friends");
  const kids = count(t, "kids|children|child|boys|girls|teens|teenagers|toddlers?|babies|baby");
  const people = count(t, "people|guests|pax|persons|of us");
  const couples = count(t, "couples?|married couples?");
  const familyOf = t.match(new RegExp(`family of ${NUM}`));

  if (familyOf) {
    const size = toNum(familyOf[1]);
    const famKids = kids ?? Math.max(0, size - 2);
    ex.families = [{ adults: size - famKids, children: famKids }];
    ex.adults = size - famKids;
    ex.children = famKids;
  }
  if (couples) ex.couples = couples;
  else if (/\b(my (wife|husband|partner)|me and my (wife|husband|partner)|honeymoon|anniversary)\b/.test(t)) ex.couples = 1;

  if (adults !== undefined) ex.adults = Math.max(ex.adults ?? 0, adults);
  if (kids !== undefined) ex.children = kids;
  if (people !== undefined && ex.adults === undefined) ex.adults = Math.max(0, people - (ex.children ?? 0));

  const drivers = count(t, "drivers?|bus drivers?");
  if (drivers) ex.drivers = drivers;
  else if (/\b(our|the|a|plus|with|and) (bus |coach )?driver\b/.test(t)) ex.drivers = 1;
  const leaders = count(t, "coach(?:es)?|group leaders?|teachers?|chaperones?");
  if (leaders) ex.groupLeaders = leaders;
  else if (/\b(group leader|team manager|tour leader)\b/.test(t)) ex.groupLeaders = 1;

  if (/wheel ?chair/.test(t)) {
    ex.wheelchairUsers = count(t, "wheel ?chair users?") ?? 1;
    ex.notes!.push("Wheelchair access requested");
  }
  if (/ground floor|no stairs|can'?t (do|manage|climb) (the )?stairs|walking frame|mobility|elderly/.test(t)) {
    ex.groundFloorGuests = Math.max(ex.groundFloorGuests ?? 0, 2);
    ex.notes!.push("Ground-floor room requested");
  }
  if (/separate beds|own beds?|twin beds|not share (a )?bed|single beds/.test(t)) {
    ex.separateBeds = true;
    ex.notes!.push("Separate beds requested");
  }
  if (/self[- ]?catering|kitchen|cook our own/.test(t)) {
    ex.selfCatering = true;
    ex.notes!.push("Interested in self-catering");
  }
  if (/stay together|together as a family|same room|all together/.test(t)) ex.notes!.push("Wants to stay together");
  if (/halaal|halal/.test(t)) ex.notes!.push("Asked about Halaal food — refer to concierge, do not assume certification");

  // A couple described within a family is not a separate couple.
  if (ex.families?.length && ex.couples === 1 && !couples) delete ex.couples;
  return ex;
}
