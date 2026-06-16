import type { Album, Artist, Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import type { View } from "../../state/app";
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

const artist: Artist = { id: "ar1", serverId: "s1", name: "The Artist", thumb: "/art.jpg" };
const album: Album = { id: "al1", serverId: "s1", artistId: "ar1", title: "The Album" };
const homeView: View = { name: "home" };
const artistView: View = { name: "artist", artist };
const albumView: View = { name: "album", album };

describe("derivePanelFocus", () => {
  it("override wins over everything else", () => {
    const override = { kind: "artist", artistName: "Override" } as const;
    expect(
      derivePanelFocus({
        override,
        selectedTrack: track("a"),
        view: artistView,
        nowPlaying: track("b"),
      }),
    ).toBe(override);
  });

  it("selected track wins over view and now-playing", () => {
    const selected = track("sel");
    expect(
      derivePanelFocus({
        override: null,
        selectedTrack: selected,
        view: artistView,
        nowPlaying: track("np"),
      }),
    ).toEqual({ kind: "song", track: selected });
  });

  it("artist view → artist payload (when no override/selection)", () => {
    expect(
      derivePanelFocus({
        override: null,
        selectedTrack: null,
        view: artistView,
        nowPlaying: track("np"),
      }),
    ).toEqual({
      kind: "artist",
      artistName: "The Artist",
      artistId: "ar1",
      serverId: "s1",
      thumb: "/art.jpg",
    });
  });

  it("album view → album payload", () => {
    expect(
      derivePanelFocus({
        override: null,
        selectedTrack: null,
        view: albumView,
        nowPlaying: track("np"),
      }),
    ).toEqual({ kind: "album", album });
  });

  it("falls back to now-playing when view is neither artist nor album", () => {
    const np = track("np");
    expect(
      derivePanelFocus({ override: null, selectedTrack: null, view: homeView, nowPlaying: np }),
    ).toEqual({ kind: "song", track: np });
  });

  it("returns null when nothing is focused", () => {
    expect(
      derivePanelFocus({ override: null, selectedTrack: null, view: homeView, nowPlaying: null }),
    ).toBeNull();
  });
});
