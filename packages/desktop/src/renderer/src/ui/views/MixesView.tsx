import { useEffect, useState } from "react";
import { sampleThumbs } from "../../../../logic/collage";
import { albumsForMix, MOOD_MIXES } from "../../../../logic/mood-mixes";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { CardCollage } from "../CardCollage";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; thumbsByMix: Map<string, string[]> };

/** The curated mood mixes. Cards show an album-art collage sampled from the
 *  albums whose tags match each mix; matched track counts would need the full
 *  track list too, so the per-mix view computes the actual contents on demand. */
export function MixesView() {
  const { library, dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    window.musex
      .listAllAlbums(id, "title", validator)
      .then((albums) => {
        if (cancelled) return;
        const thumbsByMix = new Map(
          MOOD_MIXES.map((mix) => [
            mix.id,
            sampleThumbs(
              albumsForMix(mix, albums).map((a) => a.thumb),
              4,
              mix.id,
            ),
          ]),
        );
        setFetch({ status: "ok", thumbsByMix });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load albums",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [library]);

  if (fetch.status === "loading") {
    return <div className="content-placeholder">Loading mixes…</div>;
  }

  if (fetch.status === "error") {
    return <div className="content-placeholder error-text">Error: {fetch.message}</div>;
  }

  const { thumbsByMix } = fetch;

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Mixes</h3>
      </div>
      <div className="browse-sub">
        Dynamic playlists built from your library's genre and mood tags
      </div>
      <div className="genre-grid">
        {MOOD_MIXES.map((mix) => (
          <button
            key={mix.id}
            type="button"
            className="genre-card mix-card"
            onClick={() => dispatch({ type: "navigate", view: { name: "mix", mixId: mix.id } })}
          >
            <CardCollage thumbs={thumbsByMix.get(mix.id) ?? []} className="genre-card-collage" />
            <div className="genre-card-name">{mix.title}</div>
            <div className="mix-card-desc">{mix.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
