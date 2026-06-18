import { describe, expect, it } from "vitest";
import { resolveEntity } from "../logic/entity-ref.js";
import { entityRefForArtist, externalArtistRef } from "../models/entity-ref.js";
import type { Artist } from "../models/index.js";
import { ENTITY_STATE, type EntityState, entityState } from "./entity-state.js";
import { colors } from "./tokens.js";

const ownedArtist: Artist = { id: "a1", serverId: "srv-1", name: "Radiohead" };
const owned = resolveEntity(entityRefForArtist(ownedArtist));
const external = resolveEntity(externalArtistRef("Radiohead"));

const ALL_STATES: EntityState[] = [
  "owned",
  "unowned",
  "downloaded",
  "downloading",
  "following",
  "acquiring",
  "available",
  "unavailable",
];

describe("design tokens", () => {
  it("palette has the verbatim brand values", () => {
    expect(colors.green).toBe("#54d2a0");
    expect(colors.bg).toBe("#0d0e12");
    expect(colors.purple).toBe("#7c5cff");
  });
});

describe("ENTITY_STATE vocabulary", () => {
  it("every state maps to a real color token + an icon + a label", () => {
    for (const state of ALL_STATES) {
      const entry = ENTITY_STATE[state];
      expect(entry).toBeDefined();
      expect(colors).toHaveProperty(entry.colorToken);
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe("entityState precedence", () => {
  it("owned plex artist with no flags → owned", () => {
    expect(entityState(owned, {})).toBe("owned");
  });

  it("external acquirable artist with no flags → available", () => {
    expect(entityState(external, {})).toBe("available");
  });

  it("downloading wins over downloaded", () => {
    expect(entityState(owned, { downloading: true, downloaded: true })).toBe("downloading");
  });

  it("acquiring wins over downloaded/following", () => {
    expect(entityState(external, { acquiring: true, downloaded: true, following: true })).toBe(
      "acquiring",
    );
  });

  it("following wins over owned", () => {
    expect(entityState(owned, { following: true })).toBe("following");
  });

  it("unavailable applies only to external entities", () => {
    expect(entityState(external, { unavailable: true })).toBe("unavailable");
    // plex entity with unavailable flag falls through to owned
    expect(entityState(owned, { unavailable: true })).toBe("owned");
  });
});
