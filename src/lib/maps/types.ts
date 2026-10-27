/**
 * Smart Maps domain types — property-agnostic so the same component can be
 * reused for any hospitality property.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export type PlaceCategory =
  | "halaal-food"
  | "hospitals"
  | "universities"
  | "shopping"
  | "beaches"
  | "family"
  | "sports"
  | "airport"
  | "transport"
  | "events";

export interface CategoryInfo {
  id: PlaceCategory;
  label: string;
  icon: string;
  /** Google Places (New) primary types to use once that provider is approved. */
  googleTypes: string[];
}

export type DataSource = "sample" | "google-places" | "osm";

export interface HalaalInfo {
  /** "unverified" unless a certifying body or venue has confirmed it via a live data source. */
  status: "unverified" | "verified";
  authority?: string;
  checkedAt?: string;
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  location: LatLng;
  address?: string;
  description?: string;
  source: DataSource;
  /** Real landmark whose demo coordinates are approximate and still need provider verification. */
  approximateLocation?: boolean;
  /** A made-up placeholder that does not exist. */
  fictional?: boolean;
  familyFriendly?: boolean;
  /** Only ever populated from a live provider — never typed in by hand. */
  openingHours?: string[];
  halaal?: HalaalInfo;
}

export interface ArrivalInfo {
  address: string;
  parking: string[];
  arrival: string[];
  checkIn: string;
  checkOut: string;
  emergency: string[];
}

export interface MapProperty {
  id: string;
  name: string;
  location: LatLng;
  fictional: boolean;
  arrival: ArrivalInfo;
  /** Default map zoom level. */
  zoom: number;
}

export type TravelMode = "driving" | "walking" | "transit";

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Which genuine routing provider produced this. */
  provider: string;
  mode: TravelMode;
}
