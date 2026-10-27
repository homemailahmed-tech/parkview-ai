import { simulateExtraction } from "../enquiry/simulatedParser";
import { simulateConciergeIntent } from "../maps/concierge";
import type { ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext } from "./types";

/**
 * SIMULATION MODE — deterministic, rule-based responses so the demo runs
 * without credentials. Clearly labelled in the UI; never presented as Meta AI.
 */
export class SimulationProvider implements HospitalityAIProvider {
  readonly info = { kind: "simulation" as const, id: "simulation" as const, label: "Simulation mode (rule-based, not AI)" };

  async interpretEnquiry(text: string, ctx: InterpretContext): Promise<unknown> {
    return simulateExtraction(text, ctx.today);
  }

  async explainOptions(input: ExplainInput): Promise<string> {
    const lines = input.options.map((o) => {
      const rooms = o.assignments.map((a) => input.roomNames[a.roomId] ?? a.roomId).join(", ");
      const extra = o.compromises.length ? ` Note: ${o.compromises.join("; ")}.` : "";
      return `${o.title}: ${rooms}.${extra}`;
    });
    return [...lines, input.comparison].join("\n");
  }

  async draftQuoteIntro(input: DraftInput): Promise<string> {
    const notes = input.notes.length ? ` We have noted: ${input.notes.join("; ").toLowerCase()}.` : "";
    return `Dear ${input.guestName}, thank you for choosing ${input.propertyName}. We would love to host you and have prepared the arrangement below (${input.optionTitle.replace(/^Option [A-Z] · /, "")}).${notes}`;
  }

  async interpretConciergeQuestion(input: ConciergeInput): Promise<unknown> {
    return simulateConciergeIntent(input.question, input.categories);
  }
}
