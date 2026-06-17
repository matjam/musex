export interface LocalPresence {
  downloaded: boolean;
  cached: boolean;
}

export type Availability = "playable" | "unavailable-offline";

/** Offline-playable = downloaded ∪ cached. Online, everything is playable. */
export function trackAvailability(local: LocalPresence, online: boolean): Availability {
  if (online) return "playable";
  return local.downloaded || local.cached ? "playable" : "unavailable-offline";
}
