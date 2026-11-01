/**
 * FICTIONAL, deliberately difficult WhatsApp enquiries for the demo and tests: informal text,
 * mixed languages, relative dates, corrections and contradictions. They exist to show where a
 * language model is needed — and where the app must ask instead of guessing. Names are invented.
 */
export interface HardEnquiry {
  id: string;
  guestName: string;
  label: string;
  text: string;
  /** What a careful human reading the message would conclude (used only to describe the challenge, never by the app). */
  challenge: string;
}

export const HARD_ENQUIRIES: HardEnquiry[] = [
  {
    id: "H-1",
    guestName: "Thandeka",
    label: "Netball team (isiZulu greeting, relative date)",
    text: "Sawubona! We have 12 netball girls, two coaches and the bus driver coming the Friday after next. One coach uses crutches, so please no stairs. The driver needs his own room. We might stay two nights. Ngiyabonga, Thandeka",
    challenge: "15 people (12 girls + 2 coaches + driver); a relative date; 'might' two nights must be confirmed; ground floor for one coach; private room for the driver.",
  },
  {
    id: "H-2",
    guestName: "Mpho",
    label: "Choir correction (later message overrides)",
    text: "Hi there 👋 it's Mpho from the choir. Change of plans from what I said yesterday: not 14 anymore, now 16 of us. The 4 married couples still want to share a bed, everyone else separate beds pls. And make it 3 nights instead of 2, arriving 21 Nov. Oh and gogo is coming too, she can't do stairs.",
    challenge: "Is gogo (grandmother) one of the 16 or the 17th? Must be clarified, not guessed. 3 nights from 21 Nov. 4 couples share; others separate beds; one guest ground floor.",
  },
  {
    id: "H-3",
    guestName: "Annelie",
    label: "Afrikaans family",
    text: "Goeie môre! Ons is 'n gesin van vyf – twee volwassenes en drie kinders – plus my ouma wat nie trappe kan klim nie. Kan ons vir 'n week bly vanaf 14 Desember? Selfsorg sou lekker wees. Dankie, Annelie",
    challenge: "Afrikaans: 3 adults (2 parents + grandmother) and 3 children; 7 nights from 14 Dec; ground floor for the grandmother; self-catering preferred.",
  },
];
