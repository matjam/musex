import type { Library, Server } from "../models/index.js";

/** The server to default to: the one the account OWNS, else the first. */
export function pickDefaultServer(servers: Server[]): Server | null {
  return servers.find((s) => s.owned) ?? servers[0] ?? null;
}

/** The library to default to: the first OWNED one, else the first. */
export function pickDefaultLibrary(libraries: Library[]): Library | null {
  return libraries.find((l) => l.owned) ?? libraries[0] ?? null;
}
