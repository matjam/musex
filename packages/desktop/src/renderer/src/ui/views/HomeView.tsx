import type { Album, Artist } from "@musex/core";
import { useEffect, useState } from "react";
import type { SectionDto } from "../../../../shared/ipc-contract";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { usePlaylists } from "../../state/playlists";
import { GridCard } from "../GridCard";
import { useCollectionPlay } from "../hooks/useCollectionPlay";
import { PluginSections } from "../PluginSections";

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
  const { playlists } = usePlaylists();
  const { playAlbum, playArtist, playPlaylist } = useCollectionPlay();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [pluginSections, setPluginSections] = useState<SectionDto[]>([]);

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
      })
      .catch(() => {
        // overview is best-effort; leave sections empty on error
      });
    return () => {
      cancelled = true;
    };
  }, [library]);

  const topPlaylists = playlists.slice(0, 8);
  const empty =
    topPlaylists.length === 0 &&
    artists.length === 0 &&
    albums.length === 0 &&
    pluginSections.every((s) => s.items.length === 0);

  return (
    <div className="browse-section home-view">
      <h2 className="home-greeting">Home</h2>

      {topPlaylists.length > 0 && (
        <section className="home-row">
          <h3 className="browse-title">Your playlists</h3>
          <div className="browse-grid">
            {topPlaylists.map((p) => (
              <GridCard
                key={p.id}
                thumb={p.thumb}
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
                onOpen={() => dispatch({ type: "navigate", view: { name: "artist", artist: a } })}
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
                onOpen={() => dispatch({ type: "navigate", view: { name: "album", album: a } })}
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
