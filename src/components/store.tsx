"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Actor, Booking, Enquiry } from "@/lib/domain/types";
import { DEMO_PROPERTY, createDemoBookings } from "@/lib/data/property";
import { createDemoEnquiries } from "@/lib/data/demoEnquiries";
import { todayISO } from "@/lib/domain/dates";
import { bookingsForConfirmed, transition, type WorkflowAction } from "@/lib/workflow/stateMachine";

export type Role = "staff" | "owner";

interface DemoState {
  enquiries: Enquiry[];
  bookings: Booking[];
  role: Role;
  ownerName: string;
  baseDate: string;
}

interface StoreValue extends DemoState {
  today: string;
  setRole(role: Role): void;
  addEnquiry(e: Enquiry): void;
  updateEnquiry(id: string, patch: Partial<Enquiry>): void;
  /** Runs a validated workflow transition. Returns an error message on refusal. */
  act(id: string, action: WorkflowAction, actor?: Actor): string | null;
  reset(): void;
}

const STORAGE_KEY = "hospitality-ai-demo-v1";
const Ctx = createContext<StoreValue | null>(null);

function freshState(): DemoState {
  const base = todayISO();
  const seeded = createDemoEnquiries(base, createDemoBookings(base));
  return { ...seeded, role: "staff", ownerName: "Demo Owner", baseDate: base };
}

function load(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    return Array.isArray(parsed.enquiries) && Array.isArray(parsed.bookings) ? parsed : null;
  } catch {
    return null;
  }
}

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);

  useEffect(() => {
    setState(load() ?? freshState());
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — demo still works in memory */
    }
  }, [state]);

  const act = useCallback(
    (id: string, action: WorkflowAction, actor?: Actor): string | null => {
      if (!state) return "Not ready";
      const e = state.enquiries.find((x) => x.id === id);
      if (!e) return "Enquiry not found";
      try {
        const next = transition(e, action, {
          actor: actor ?? state.role,
          rooms: DEMO_PROPERTY.rooms,
          bookings: state.bookings,
          depositPercent: DEMO_PROPERTY.depositPercent,
        });
        setState((s) =>
          s && {
            ...s,
            enquiries: s.enquiries.map((x) => (x.id === id ? next : x)),
            bookings: next.status === "confirmed" ? [...s.bookings, ...bookingsForConfirmed(next)] : s.bookings,
          },
        );
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [state],
  );

  const value = useMemo<StoreValue | null>(() => {
    if (!state) return null;
    return {
      ...state,
      today: todayISO(),
      setRole: (role) => setState((s) => s && { ...s, role }),
      addEnquiry: (e) => setState((s) => s && { ...s, enquiries: [e, ...s.enquiries] }),
      updateEnquiry: (id, patch) =>
        setState((s) => s && { ...s, enquiries: s.enquiries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
      act,
      reset: () => setState(freshState()),
    };
  }, [state, act]);

  if (!value) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading demo…</div>;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside DemoStoreProvider");
  return v;
}
