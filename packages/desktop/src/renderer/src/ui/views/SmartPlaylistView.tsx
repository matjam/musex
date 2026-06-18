import type { Library, Track } from "@musex/core";
import {
  composeForYou,
  computeSmartPlaylist,
  downloadRecordFor,
  type ForYouInput,
  listValidator,
  SMART_TITLES,
  type SmartKind,
} from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { ActionBar } from "../discovery/ActionBar";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY_MESSAGES: Record<SmartKind, string> = {
  "for-you": "Play and rate more music first — For You builds on your listening history.",
  "top-rated": "Nothing here yet — rate tracks 4 stars or more and they'll show up.",
  "heavy-rotation": "Nothing here yet — keep listening and your most-played tracks will show up.",
  rediscover: "Nothing to rediscover yet — favorites you haven't played in a while land here.",
};

/** For You needs several round trips (taste → similar → albums → tracks). */
const LOADING_MESSAGES: Record<SmartKind, string> = {
  "for-you": "Mixing from your taste profile…",
  "top-rated": "Loading…",
  "heavy-rotation": "Loading…",
  rediscover: "Loading…",
};

/** How many taste-profile top artists seed the For You mix. */
const FOR_YOU_SEEDS = 5;
/** Total owned artists (seeds + similar-owned) feeding the mix. */
const FOR_YOU_MAX_ARTISTS = 12;

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

/** The three rule-based kinds: all library tracks + taste snapshot → pure rules. */
async function loadStandard(
  kind: Exclude<SmartKind, "for-you">,
  library: Library,
): Promise<Track[]> {
  const validator = listValidator(library.updatedAt);
  const [tracks, snapshot] = await Promise.all([
    window.musex.listAllTracks(library.id, "title", validator),
    window.musex.getTasteSnapshot(),
  ]);
  return computeSmartPlaylist(kind, tracks, snapshot.stats, snapshot.topArtists, Date.now());
}

/**
 * For You: taste snapshot → top seed artists → resolve each seed to an OWNED
 * artist (live search, exact name match) + collect owned artists SIMILAR to it
 * (similarGet; needs a similar-provider plugin) → fetch every candidate
 * artist's tracks via the cached album/track lists → pure composer.
 * similarGet/search failures degrade to whatever resolved (own-artists-only is
 * still a useful mix); per-artist track fetch failures skip that artist.
 */
async function loadForYou(library: Library): Promise<Track[]> {
  const snapshot = await window.musex.getTasteSnapshot();
  const seeds = snapshot.topArtists.slice(0, FOR_YOU_SEEDS);
  if (seeds.length === 0) return [];

  const ownTop: (ForYouInput["ownTop"][number] & { updatedAt?: number })[] = [];
  const similarCandidates: ForYouInput["similarOwned"] = [];
  // Seeds are processed sequentially (polite to Plex + the similar provider);
  // within a seed the search and similarGet fan out together.
  for (const seed of seeds) {
    const [own, similar] = await Promise.all([
      window.musex
        .search(library.id, seed.name)
        .then(
          (results) =>
            results.artists.find((a) => a.name.toLowerCase() === seed.name.toLowerCase()) ?? null,
        )
        .catch((err: unknown) => {
          console.warn(`[for-you] artist search failed for "${seed.name}":`, err);
          return null;
        }),
      window.musex.similarGet({ kind: "artist", name: seed.name }).catch((err: unknown) => {
        console.warn(`[for-you] similarGet failed for "${seed.name}":`, err);
        return [];
      }),
    ]);
    if (own) {
      ownTop.push({
        artistId: own.id,
        name: own.name,
        score: seed.score,
        updatedAt: own.updatedAt,
      });
    }
    for (const item of similar) {
      if (item.artistId) {
        similarCandidates.push({ artistId: item.artistId, name: item.name, viaArtist: seed.name });
      }
    }
  }

  // Unique owned artists, seeds first, capped.
  const seen = new Set(ownTop.map((a) => a.artistId));
  const similarOwned: ForYouInput["similarOwned"] = [];
  for (const c of similarCandidates) {
    if (ownTop.length + similarOwned.length >= FOR_YOU_MAX_ARTISTS) break;
    if (seen.has(c.artistId)) continue;
    seen.add(c.artistId);
    similarOwned.push(c);
  }

  // Fetch each artist's tracks (cached lists): albums in parallel per artist,
  // artists sequential to be polite.
  const tracksByArtist = new Map<string, Track[]>();
  const candidates: { artistId: string; updatedAt?: number }[] = [...ownTop, ...similarOwned];
  for (const artist of candidates) {
    try {
      const albums = await window.musex.listAlbums(
        library.id,
        artist.artistId,
        listValidator(artist.updatedAt),
      );
      const arrays = await Promise.all(
        albums.map((a) => window.musex.listTracks(library.id, a.id, listValidator(a.updatedAt))),
      );
      tracksByArtist.set(artist.artistId, arrays.flat());
    } catch (err) {
      console.warn(`[for-you] track fetch failed for artist ${artist.artistId}:`, err);
    }
  }

  const stats = new Map(
    snapshot.stats.map((s) => [
      s.key,
      { plays: s.plays, skips: s.skips, lastPlayedMs: s.lastPlayedMs, ratingStars: s.ratingStars },
    ]),
  );
  return composeForYou({
    ownTop: ownTop.map(({ artistId, name, score }) => ({ artistId, name, score })),
    similarOwned,
    tracksByArtist,
    stats,
    nowMs: Date.now(),
  });
}

export function SmartPlaylistView({ kind }: { kind: SmartKind }) {
  const { library } = useApp();
  const downloadRecords = useDownloadRecords();
  const { state, playTracks, playTracksShuffled, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    setFetch({ status: "loading" });
    const load = kind === "for-you" ? loadForYou(library) : loadStandard(kind, library);
    load
      .then((tracks) => {
        if (!cancelled) setFetch({ status: "ok", tracks });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load tracks",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [library, kind]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="tracks-view-header">
        <div className="browse-header">
          <h3 className="browse-title">{SMART_TITLES[kind]}</h3>
          <div className="tracks-header-actions">
            {fetch.status === "ok" && fetch.tracks.length > 0 && (
              <ActionBar
                onPlay={() => playTracks(fetch.tracks, 0)}
                onShuffle={() => playTracksShuffled(fetch.tracks)}
              />
            )}
          </div>
        </div>
        {fetch.status === "ok" && (
          <div className="browse-sub">
            {fetch.tracks.length} track{fetch.tracks.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {fetch.status === "loading" && (
        <div className="content-placeholder">{LOADING_MESSAGES[kind]}</div>
      )}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length === 0 && (
        <div className="content-placeholder">{EMPTY_MESSAGES[kind]}</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length > 0 && (
        <VirtualTrackList
          count={fetch.tracks.length}
          renderRow={(index) => {
            const track = fetch.tracks[index];
            if (!track) return null;
            return (
              <TrackRow
                track={track}
                leading={null}
                showSubtitle
                isPlaying={track.id === playingTrackId}
                selected={track.id === selectedTrack?.id}
                onSelect={() => select(track)}
                onActivate={() => playTrackNext(track)}
                onMenu={(pos) =>
                  setMenu({
                    ...pos,
                    trackId: track.id,
                    serverId: track.serverId,
                    track,
                  })
                }
              />
            );
          }}
        />
      )}

      {menu !== null && (
        <TrackContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onNewPlaylist={(id) => {
            setNewSeed([id]);
            setMenu(null);
          }}
          downloadRecord={downloadRecordFor(downloadRecords, menu.track)}
          libraryId={library?.id ?? null}
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}
    </div>
  );
}
