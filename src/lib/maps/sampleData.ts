import type { CategoryInfo, MapProperty, Place } from "./types";

export const CATEGORIES: CategoryInfo[] = [
  { id: "halaal-food", label: "Halaal food", icon: "🍽️", googleTypes: ["restaurant"] },
  { id: "hospitals", label: "Hospitals", icon: "🏥", googleTypes: ["hospital"] },
  { id: "universities", label: "Universities", icon: "🎓", googleTypes: ["university"] },
  { id: "shopping", label: "Shopping", icon: "🛍️", googleTypes: ["shopping_mall"] },
  { id: "beaches", label: "Beaches", icon: "🏖️", googleTypes: ["beach"] },
  { id: "family", label: "Family attractions", icon: "🎡", googleTypes: ["amusement_park", "aquarium", "zoo", "park"] },
  { id: "sports", label: "Sports venues", icon: "🏟️", googleTypes: ["stadium", "sports_complex"] },
  { id: "airport", label: "Airport", icon: "✈️", googleTypes: ["international_airport", "airport"] },
  { id: "transport", label: "Transport", icon: "🚆", googleTypes: ["train_station", "bus_station", "transit_station"] },
  { id: "events", label: "Local events", icon: "🎫", googleTypes: ["event_venue"] },
];

/**
 * FICTIONAL demonstration guest house, placed in Durban's Morningside area.
 * The property, address and arrival details are invented for the demo.
 */
export const DEMO_MAP_PROPERTY: MapProperty = {
  id: "parkside-demo",
  name: "Parkside Demo Guest House",
  location: { lat: -29.8305, lng: 31.0065 },
  fictional: true,
  zoom: 13,
  arrival: {
    address: "Fictional address — Morningside, Durban (demo only)",
    parking: [
      "Secure off-street parking for 8 cars behind the gate (demo detail).",
      "One coach/minibus bay — please tell us in advance if you arrive by bus.",
      "Street parking is not recommended overnight.",
    ],
    arrival: [
      "Press the intercom at the main gate; reception is staffed until 20:00 (demo detail).",
      "Late arrival? Message us on WhatsApp beforehand so we can arrange access.",
      "Room 1 has step-free access from the parking area.",
    ],
    checkIn: "From 14:00",
    checkOut: "By 10:00",
    emergency: ["South Africa emergency number from a mobile: 112", "Ambulance: 10177", "Police: 10111"],
  },
};

const sample = { source: "sample" as const };
const approx = { ...sample, approximateLocation: true };
const fictional = { ...sample, fictional: true };

/**
 * Sample destinations for the demo while live Places data is pending.
 * - Real public landmarks carry `approximateLocation` — coordinates are
 *   approximate and must be verified by a live mapping provider.
 * - Halaal eateries and events are FICTIONAL placeholders; we never assert
 *   Halaal certification or opening hours without a live, authoritative source.
 */
export const SAMPLE_PLACES: Place[] = [
  // Halaal food — fictional placeholders only
  { ...fictional, id: "hf-1", name: "Sample Halaal Eatery A (fictional)", category: "halaal-food", location: { lat: -29.8548, lng: 31.0172 }, description: "Placeholder — live Places data will list real venues.", halaal: { status: "unverified" }, familyFriendly: true },
  { ...fictional, id: "hf-2", name: "Sample Halaal Grill B (fictional)", category: "halaal-food", location: { lat: -29.8372, lng: 31.0115 }, description: "Placeholder — live Places data will list real venues.", halaal: { status: "unverified" } },

  // Hospitals
  { ...approx, id: "hos-1", name: "Addington Hospital", category: "hospitals", location: { lat: -29.8636, lng: 31.0445 }, description: "Public hospital near South Beach." },
  { ...approx, id: "hos-2", name: "Inkosi Albert Luthuli Central Hospital", category: "hospitals", location: { lat: -29.8726, lng: 30.9796 }, description: "Large public referral hospital." },

  // Universities
  { ...approx, id: "uni-1", name: "UKZN Howard College Campus", category: "universities", location: { lat: -29.8675, lng: 30.9805 } },
  { ...approx, id: "uni-2", name: "Durban University of Technology (Steve Biko Campus)", category: "universities", location: { lat: -29.8530, lng: 31.0063 } },

  // Shopping
  { ...approx, id: "shop-1", name: "Gateway Theatre of Shopping", category: "shopping", location: { lat: -29.7270, lng: 31.0663 }, familyFriendly: true },
  { ...approx, id: "shop-2", name: "Musgrave Centre", category: "shopping", location: { lat: -29.8467, lng: 31.0006 } },
  { ...approx, id: "shop-3", name: "The Pavilion", category: "shopping", location: { lat: -29.8489, lng: 30.9348 } },

  // Beaches
  { ...approx, id: "beach-1", name: "North Beach", category: "beaches", location: { lat: -29.8485, lng: 31.0372 }, familyFriendly: true },
  { ...approx, id: "beach-2", name: "uMhlanga Main Beach", category: "beaches", location: { lat: -29.7262, lng: 31.0887 }, familyFriendly: true },

  // Family attractions
  { ...approx, id: "fam-1", name: "uShaka Marine World", category: "family", location: { lat: -29.8676, lng: 31.0456 }, familyFriendly: true, description: "Aquarium and water park." },
  { ...approx, id: "fam-2", name: "Durban Botanic Gardens", category: "family", location: { lat: -29.8466, lng: 31.0087 }, familyFriendly: true },
  { ...approx, id: "fam-3", name: "Mitchell Park", category: "family", location: { lat: -29.8310, lng: 31.0090 }, familyFriendly: true, description: "Park with small animal enclosures and playground." },

  // Sports venues
  { ...approx, id: "sport-1", name: "Moses Mabhida Stadium", category: "sports", location: { lat: -29.8290, lng: 31.0302 } },
  { ...approx, id: "sport-2", name: "Kings Park Stadium", category: "sports", location: { lat: -29.8254, lng: 31.0292 } },
  { ...approx, id: "sport-3", name: "Kingsmead Cricket Ground", category: "sports", location: { lat: -29.8506, lng: 31.0286 } },

  // Airport
  { ...approx, id: "air-1", name: "King Shaka International Airport (DUR)", category: "airport", location: { lat: -29.6144, lng: 31.1197 } },

  // Transport
  { ...approx, id: "tr-1", name: "Durban Station", category: "transport", location: { lat: -29.8494, lng: 31.0226 } },

  // Local events — fictional placeholders
  { ...fictional, id: "ev-1", name: "Sample Weekend Craft Market (fictional event)", category: "events", location: { lat: -29.8466, lng: 31.0087 }, familyFriendly: true, description: "Placeholder event — a live events feed will replace this." },
  { ...fictional, id: "ev-2", name: "Sample Beachfront Fun Run (fictional event)", category: "events", location: { lat: -29.8485, lng: 31.0372 }, description: "Placeholder event — a live events feed will replace this." },
];
