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

export interface OwnerAccess {
  checked: boolean;
  /** Valid server-side owner session (HttpOnly cookie). */
  owner: boolean;
  ownerLoginEnabled: boolean;
  /** Deployment lets visitors try owner role in their own sandbox without a code. */
  publicOwnerMode: boolean;
}

interface StoreValue extends DemoState {
  today: string;
  ownerAccess: OwnerAccess;
  /** True when owner-only controls may be used in this browser. */
  canActAsOwner: boolean;
  /** Switches role. Switching to owner only works with owner access. */
  setRole(role: Role): void;
  loginOwner(code: string): Promise<string | null>;
  logoutOwner(): Promise<void>;
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

const NO_ACCESS: OwnerAccess = { checked: false, owner: false, ownerLoginEnabled: false, publicOwnerMode: false };

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccess>(NO_ACCESS);
  const canActAsOwner = ownerAccess.owner || ownerAccess.publicOwnerMode;

  useEffect(() => {
    setState(load() ?? freshState());
    fetch("/api/owner/session")
      .then((r) => r.json())
      .then((b) => setOwnerAccess({ checked: true, owner: !!b.owner, ownerLoginEnabled: !!b.ownerLoginEnabled, publicOwnerMode: !!b.publicOwnerMode }))
      .catch(() => setOwnerAccess({ ...NO_ACCESS, checked: true }));
  }, []);

  // A role remembered from an earlier visit never outlives the owner session.
  useEffect(() => {
    if (ownerAccess.checked && !canActAsOwner && state?.role === "owner") setState((s) => s && { ...s, role: "staff" });
  }, [ownerAccess, canActAsOwner, state?.role]);

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
      if ((actor ?? state.role) === "owner" && !canActAsOwner) return "Owner login required for this action";
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
    [state, canActAsOwner],
  );

  const loginOwner = useCallback(async (code: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/owner/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!res.ok) {
        if (res.status === 429) return "Too many attempts — please wait 15 minutes.";
        return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Login failed";
      }
      setOwnerAccess((a) => ({ ...a, owner: true }));
      setState((s) => s && { ...s, role: "owner" });
      return null;
    } catch {
      return "Could not reach the server — check your connection.";
    }
  }, []);

  const logoutOwner = useCallback(async () => {
    await fetch("/api/owner/logout", { method: "POST" }).catch(() => undefined);
    setOwnerAccess((a) => ({ ...a, owner: false }));
    setState((s) => s && { ...s, role: "staff" });
  }, []);

  const value = useMemo<StoreValue | null>(() => {
    if (!state) return null;
    return {
      ...state,
      today: todayISO(),
      ownerAccess,
      canActAsOwner,
      setRole: (role) => {
        if (role === "owner" && !canActAsOwner) return;
        setState((s) => s && { ...s, role });
      },
      loginOwner,
      logoutOwner,
      addEnquiry: (e) => setState((s) => s && { ...s, enquiries: [e, ...s.enquiries] }),
      updateEnquiry: (id, patch) =>
        setState((s) => s && { ...s, enquiries: s.enquiries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
      act,
      reset: () => setState(freshState()),
    };
  }, [state, act, ownerAccess, canActAsOwner, loginOwner, logoutOwner]);

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
