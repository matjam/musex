import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { derivePanelFocus } from "./panel-focus";

const track = (id: string): Track => ({
  id,
  serverId: "s1",
  albumId: "al1",
  artistId: "ar1",
  artistName: "Artist",
  title: `Track ${id}`,
  durationMs: 1000,
  media: { container: "flac", audioCodec: "flac", partId: "p", partKey: "/k" },
});

// The context panel is now-playing / track-detail context ONLY (entity
// navigation goes to the unified pages, never the panel), so focus is a track:
// selection wins over now-playing; nothing focused → null.
describe("derivePanelFocus", () => {
  it("selected track wins over now-playing", () => {
    const selected = track("sel");
    expect(derivePanelFocus({ selectedTrack: selected, nowPlaying: track("np") })).toEqual({
      kind: "song",
      track: selected,
    });
  });

  it("falls back to now-playing when nothing is selected", () => {
    const np = track("np");
    expect(derivePanelFocus({ selectedTrack: null, nowPlaying: np })).toEqual({
      kind: "song",
      track: np,
    });
  });

  it("returns null when nothing is focused", () => {
    expect(derivePanelFocus({ selectedTrack: null, nowPlaying: null })).toBeNull();
  });
});
