import type { Booking, ISODate, Property, Room } from "../domain/types";
import { addDays } from "../domain/dates";

/**
 * Parkside Demo Guest House — a FICTIONAL property used for the hackathon demo.
 * All rates are fictional sample values in South African Rand (ZAR).
 */
export const DEMO_ROOMS: Room[] = [
  {
    id: "r1",
    name: "Room 1 · Accessible Triple",
    shortName: "Room 1",
    capacity: 3,
    beds: [
      { type: "queen", count: 1 },
      { type: "single", count: 1 },
    ],
    floor: "ground",
    wheelchairAccessible: true,
    privateEntrance: false,
    selfCatering: false,
    description: "Step-free ground-floor room with roll-in shower and grab rails.",
    rate: { base: 1150, includedGuests: 2, extraGuest: 350, singleOccupancy: 850 },
  },
  {
    id: "r2",
    name: "Room 2 · Park View Triple",
    shortName: "Room 2",
    capacity: 3,
    beds: [{ type: "single", count: 3 }],
    floor: "first",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "First-floor twin/triple overlooking the park. Ideal for colleagues or friends.",
    rate: { base: 1100, includedGuests: 2, extraGuest: 350, singleOccupancy: 800 },
  },
  {
    id: "r3",
    name: "Room 3 · Corner Triple",
    shortName: "Room 3",
    capacity: 3,
    beds: [
      { type: "queen", count: 1 },
      { type: "single", count: 1 },
    ],
    floor: "first",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "Bright first-floor corner room with windows on two sides.",
    rate: { base: 1100, includedGuests: 2, extraGuest: 350, singleOccupancy: 800 },
  },
  {
    id: "r4",
    name: "Room 4 · Family Room",
    shortName: "Room 4",
    capacity: 4,
    beds: [{ type: "queen", count: 2 }],
    floor: "first",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "Spacious first-floor family room with two queen beds.",
    rate: { base: 1450, includedGuests: 2, extraGuest: 300, singleOccupancy: 1100 },
  },
  {
    id: "r5",
    name: "Room 5 · Courtyard Triple",
    shortName: "Room 5",
    capacity: 3,
    beds: [{ type: "single", count: 3 }],
    floor: "ground",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "Ground-floor room opening onto the courtyard, three single beds.",
    rate: { base: 1100, includedGuests: 2, extraGuest: 350, singleOccupancy: 800 },
  },
  {
    id: "r6",
    name: "Room 6 · Private Entrance Triple",
    shortName: "Room 6",
    capacity: 3,
    beds: [
      { type: "queen", count: 1 },
      { type: "single", count: 1 },
    ],
    floor: "ground",
    wheelchairAccessible: false,
    privateEntrance: true,
    selfCatering: false,
    description: "Ground-floor room with its own garden entrance.",
    rate: { base: 1200, includedGuests: 2, extraGuest: 350, singleOccupancy: 900 },
  },
  {
    id: "r7",
    name: "Room 7 · Ground Floor Double",
    shortName: "Room 7",
    capacity: 2,
    beds: [{ type: "double", count: 1 }],
    floor: "ground",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "Cosy ground-floor room with a double bed.",
    rate: { base: 1000, includedGuests: 2, extraGuest: 0, singleOccupancy: 750 },
  },
  {
    id: "r8",
    name: "Room 8 · Ground Floor Queen",
    shortName: "Room 8",
    capacity: 2,
    beds: [{ type: "queen", count: 1 }],
    floor: "ground",
    wheelchairAccessible: false,
    privateEntrance: false,
    selfCatering: false,
    description: "Ground-floor room with a queen bed and garden view.",
    rate: { base: 1050, includedGuests: 2, extraGuest: 0, singleOccupancy: 800 },
  },
  {
    id: "apt",
    name: "Self-Catering Apartment",
    shortName: "Apartment",
    capacity: 6,
    beds: [
      { type: "double", count: 2 },
      { type: "bunk", count: 1 },
    ],
    floor: "ground",
    wheelchairAccessible: false,
    privateEntrance: true,
    selfCatering: true,
    description: "Two-bedroom apartment with kitchen, lounge, two double beds and a bunk bed.",
    rate: { base: 2400, includedGuests: 4, extraGuest: 300 },
  },
];

export const DEMO_PROPERTY: Property = {
  name: "Parkside Demo Guest House",
  location: "Fictional demo property",
  currency: "ZAR",
  currencySymbol: "R",
  rooms: DEMO_ROOMS,
  depositPercent: 50,
  checkInTime: "14:00",
  checkOutTime: "10:00",
};

export const TOTAL_CAPACITY = DEMO_ROOMS.reduce((sum, r) => sum + r.capacity, 0);

/** Fictional existing bookings, positioned relative to `base` so the demo always looks current. */
export function createDemoBookings(base: ISODate): Booking[] {
  const d = (n: number) => addDays(base, n);
  return [
    { id: "b-101", roomId: "r1", guestName: "N. Mokoena (demo)", checkIn: d(0), checkOut: d(2), guests: 2, kind: "booking" },
    { id: "b-102", roomId: "r4", guestName: "The Pillay family (demo)", checkIn: d(1), checkOut: d(4), guests: 4, kind: "booking" },
    { id: "b-103", roomId: "apt", guestName: "J. van Wyk (demo)", checkIn: d(3), checkOut: d(10), guests: 5, kind: "booking" },
    { id: "b-104", roomId: "r7", guestName: "A. Dlamini (demo)", checkIn: d(0), checkOut: d(1), guests: 1, kind: "booking" },
    { id: "b-105", roomId: "r3", guestName: "Maintenance — repainting", checkIn: d(5), checkOut: d(7), guests: 0, kind: "blocked" },
    { id: "b-106", roomId: "r8", guestName: "S. Naidoo (demo)", checkIn: d(6), checkOut: d(9), guests: 2, kind: "booking" },
    { id: "b-107", roomId: "r2", guestName: "Coastal Cycling Club (demo)", checkIn: d(12), checkOut: d(14), guests: 3, kind: "booking" },
    { id: "b-108", roomId: "r5", guestName: "Coastal Cycling Club (demo)", checkIn: d(12), checkOut: d(14), guests: 3, kind: "booking" },
  ];
}
