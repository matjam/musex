import type { Album, Artist } from "@musex/core";
import {
  albumsForMix,
  entityRefForAlbum,
  entityRefForArtist,
  listValidator,
  MOOD_MIXES,
  SMART_DESCRIPTIONS,
  SMART_TITLES,
  type SmartKind,
  sampleThumbs,
  smartMixEmpty,
  smartMixThumbs,
} from "@musex/core";
import { useEffect, useState } from "react";
import type { SectionDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { usePlaylists } from "../../state/playlists";
import { useSmartMixes } from "../../state/smart-mixes";
import { CardCollage } from "../CardCollage";
import { GridCard } from "../GridCard";
import { useCollectionPlay } from "../hooks/useCollectionPlay";
import { PluginSections } from "../PluginSections";
import { MIX_ICONS, SMART_ICONS } from "../smart-mix-icons";

/** Home-card order for the smart playlists. */
const SMART_ORDER: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover"];

/** Fisher-Yates pick of up to `n` random items (fresh each visit). */
function pickRandom<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, n);
}

const RANDOM_COUNT = 12;

export function HomeView() {
  const { library, dispatch } = useApp();
  const { warm: warmSmartMixes } = useSmartMixes();
  const { playlists } = usePlaylists();
  const { playAlbum, playArtist, playPlaylist } = useCollectionPlay();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [mixThumbs, setMixThumbs] = useState<Map<string, string[]>>(new Map());
  const [mixEmpty, setMixEmpty] = useState<Set<string>>(new Set());
  const [smartThumbs, setSmartThumbs] = useState<Map<SmartKind, string[]>>(new Map());
  const [smartEmpty, setSmartEmpty] = useState<Set<SmartKind>>(new Set());
  const [playlistArt, setPlaylistArt] = useState<Map<string, string[]>>(new Map());
  const [playlistEmpty, setPlaylistEmpty] = useState<Set<string>>(new Set());
  const [brokenComposite, setBrokenComposite] = useState<Set<string>>(new Set());
  const [pluginSections, setPluginSections] = useState<SectionDto[]>([]);
  const [discoveries, setDiscoveries] = useState<Artist[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .sectionsGet("home")
      .then((s) => {
        if (!cancelled) setPluginSections(s);
      })
      .catch(() => {
        // plugin sections are best-effort; skip silently when unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-warm the four smart mixes in the background on Home mount so opening
  // one is instant. warm() is reentrancy-safe (no-op if already warming) and
  // runs off the render path — the rail thumbs below render immediately.
  useEffect(() => {
    if (library) warmSmartMixes();
  }, [library, warmSmartMixes]);

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    Promise.all([
      window.musex.listArtists(id, validator),
      window.musex.listAllAlbums(id, "title", validator),
    ])
      .then(([ar, al]) => {
        if (cancelled) return;
        setArtists(pickRandom(ar, RANDOM_COUNT));
        setAlbums(pickRandom(al, RANDOM_COUNT));
        // Landed taste-expansion bets from the last 30 days, resolved to
        // library artists — the row that gets new discoveries listened to.
        window.musex
          .expansionGetState()
          .then((exp) => {
            if (cancelled) return;
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const byKey = new Map(ar.map((a) => [a.name.trim().toLowerCase(), a]));
            const found: Artist[] = [];
            const seen = new Set<string>();
            for (const e of exp.entries) {
              if (e.state !== "landed" || (e.landedAt ?? 0) < cutoff) continue;
              const key = e.artistName.trim().toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              const artist = byKey.get(key);
              if (artist) found.push(artist);
            }
            setDiscoveries(found.slice(0, RANDOM_COUNT));
          })
          .catch(() => {
            // expansion is optional — no row when unavailable
          });
        // Collage art for the mood-mix cards, from the same album fetch — and
        // hide mixes whose genre/mood rules match nothing in this library.
        const mixAlbums = new Map(MOOD_MIXES.map((mix) => [mix.id, albumsForMix(mix, al)]));
        setMixThumbs(
          new Map(
            MOOD_MIXES.map((mix) => [
              mix.id,
              sampleThumbs(
                (mixAlbums.get(mix.id) ?? []).map((a) => a.thumb),
                4,
                mix.id,
              ),
            ]),
          ),
        );
        setMixEmpty(
          new Set(
            MOOD_MIXES.filter((m) => (mixAlbums.get(m.id) ?? []).length === 0).map((m) => m.id),
          ),
        );
      })
      .catch(() => {
        // overview is best-effort; leave sections empty on error
      });
    return () => {
      cancelled = true;
    };
  }, [library]);

  // Smart-mix tile art: compose each mix in the background (cheap pure rules
  // over the cached all-tracks list + taste snapshot) and collage its album art.
  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    const validator = listValidator(library.updatedAt);
    Promise.all([
      window.musex.listAllTracks(library.id, "title", validator),
      window.musex.getTasteSnapshot(),
    ])
      .then(([tracks, taste]) => {
        if (cancelled) return;
        const stats = taste.stats.map((s) => ({
          key: s.key,
          plays: s.plays,
          lastPlayedMs: s.lastPlayedMs,
          decayedPlays: s.decayedPlays,
        }));
        const now = Date.now();
        setSmartThumbs(
          new Map(
            SMART_ORDER.map((kind) => [
              kind,
              sampleThumbs(smartMixThumbs(kind, tracks, stats, taste.topArtists, now), 4, kind),
            ]),
          ),
        );
        // Tiles for mixes that would open empty just hide.
        setSmartEmpty(
          new Set(
            SMART_ORDER.filter((kind) => smartMixEmpty(kind, tracks, stats, taste.topArtists, now)),
          ),
        );
      })
      .catch(() => {
        // tile art is decoration — icon placeholder stays on failure
      });
    return () => {
      cancelled = true;
    };
  }, [library]);

  // Probe each playlist's first page: it yields fallback collage art AND
  // catches Plex smart playlists that report a leafCount but serve zero items
  // (seen live with "Recently Played") — those tiles hide entirely.
  useEffect(() => {
    const candidates = playlists.filter((p) => p.trackCount > 0).slice(0, 8);
    if (candidates.length === 0) return;
    let cancelled = false;
    for (const p of candidates) {
      window.musex
        .listPlaylistTracksPage(p.id, p.serverId, 0, 8)
        .then((page) => {
          if (cancelled) return;
          if (page.items.length === 0) {
            setPlaylistEmpty((prev) => new Set(prev).add(p.id));
            return;
          }
          const thumbs = sampleThumbs(
            page.items.map((it) => it.track.thumb),
            4,
            p.id,
          );
          if (thumbs.length > 0) {
            setPlaylistArt((prev) => new Map(prev).set(p.id, thumbs));
          }
        })
        .catch(() => {
          // art/emptiness probe is best-effort — the tile stays as-is on failure
        });
      if (p.thumb) {
        // A composite URL can exist but 404 (Plex doesn't render composites
        // for some smart playlists) — probe it; broken ones use the collage.
        // The image goes through the art-caching proxy, so it isn't wasted.
        fetch(p.thumb)
          .then((r) => {
            if (!cancelled && !r.ok) setBrokenComposite((prev) => new Set(prev).add(p.id));
          })
          .catch(() => {
            if (!cancelled) setBrokenComposite((prev) => new Set(prev).add(p.id));
          });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [playlists]);

  const topPlaylists = playlists
    .filter((p) => p.trackCount > 0 && !playlistEmpty.has(p.id))
    .slice(0, 8);
  const empty =
    topPlaylists.length === 0 &&
    artists.length === 0 &&
    albums.length === 0 &&
    pluginSections.every((s) => s.items.length === 0);

  return (
    <div className="browse-section home-view">
      <h2 className="home-greeting">Home</h2>

      <section className="home-row">
        <h3 className="browse-title">Smart Mixes</h3>
        <div className="genre-grid">
          {SMART_ORDER.filter((kind) => !smartEmpty.has(kind)).map((kind) => {
            const Icon = SMART_ICONS[kind];
            const thumbs = smartThumbs.get(kind) ?? [];
            return (
              <button
                key={kind}
                type="button"
                className={`genre-card smart-card smart-card--${kind}`}
                onClick={() => dispatch({ type: "navigate", view: { name: "smart", kind } })}
              >
                {thumbs.length > 0 ? (
                  <div className="smart-card-art smart-card-art--collage">
                    <CardCollage thumbs={thumbs} className="genre-card-collage" />
                    <span className="smart-card-glyph">
                      <Icon size={14} />
                    </span>
                  </div>
                ) : (
                  <div className="smart-card-art">
                    <Icon size={42} strokeWidth={1.5} />
                  </div>
                )}
                <div className="genre-card-name">{SMART_TITLES[kind]}</div>
                <div className="mix-card-desc">{SMART_DESCRIPTIONS[kind]}</div>
              </button>
            );
          })}
          {MOOD_MIXES.filter((mix) => !mixEmpty.has(mix.id)).map((mix) => (
            <button
              key={mix.id}
              type="button"
              className="genre-card mix-card"
              onClick={() => dispatch({ type: "navigate", view: { name: "mix", mixId: mix.id } })}
            >
              <CardCollage thumbs={mixThumbs.get(mix.id) ?? []} className="genre-card-collage" />
              <div className="genre-card-name">{mix.title}</div>
              <div className="mix-card-desc">{mix.description}</div>
            </button>
          ))}
        </div>
      </section>

      {discoveries.length > 0 && (
        <section className="home-row">
          <h3 className="browse-title">New discoveries</h3>
          <div className="browse-grid">
            {discoveries.map((a) => (
              <GridCard
                key={a.id}
                thumb={a.thumb}
                title={a.name}
                subtitle="Added for you"
                round
                entity={entityRefForArtist(a)}
                onOpen={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "artist", ref: entityRefForArtist(a) },
                  })
                }
                onPlay={() => void playArtist(a)}
              />
            ))}
          </div>
        </section>
      )}

      {topPlaylists.length > 0 && (
        <section className="home-row">
          <h3 className="browse-title">Your playlists</h3>
          <div className="browse-grid">
            {topPlaylists.map((p) => (
              <GridCard
                key={p.id}
                thumb={p.thumb}
                collage={!p.thumb || brokenComposite.has(p.id) ? playlistArt.get(p.id) : undefined}
                title={p.title}
                subtitle={`${p.trackCount} song${p.trackCount !== 1 ? "s" : ""}`}
                onOpen={() =>
                  dispatch({ type: "navigate", view: { name: "playlist", playlist: p } })
                }
                onPlay={() => void playPlaylist(p)}
              />
            ))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section className="home-row">
          <h3 className="browse-title">Artists from your library</h3>
          <div className="browse-grid">
            {artists.map((a) => (
              <GridCard
                key={a.id}
                thumb={a.thumb}
                title={a.name}
                round
                entity={entityRefForArtist(a)}
                onOpen={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "artist", ref: entityRefForArtist(a) },
                  })
                }
                onPlay={() => void playArtist(a)}
              />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="home-row">
          <h3 className="browse-title">Albums from your library</h3>
          <div className="browse-grid">
            {albums.map((a) => (
              <GridCard
                key={a.id}
                thumb={a.thumb}
                title={a.title}
                subtitle={a.year != null ? String(a.year) : undefined}
                entity={entityRefForAlbum(a)}
                onOpen={() =>
                  dispatch({ type: "navigate", view: { name: "album", ref: entityRefForAlbum(a) } })
                }
                onPlay={() => void playAlbum(a)}
              />
            ))}
          </div>
        </section>
      )}

      <PluginSections sections={pluginSections} />

      {empty && <div className="content-placeholder">Your library overview will appear here.</div>}
    </div>
  );
}
