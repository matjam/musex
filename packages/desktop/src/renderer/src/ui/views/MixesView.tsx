import { MOOD_MIXES } from "../../../../logic/mood-mixes";
import { useApp } from "../../state/app";

/** The curated mood mixes. Cards are static (title + description) — matched
 *  track counts would need the full album+track lists, so the per-mix view
 *  computes the actual contents on demand instead. */
export function MixesView() {
  const { dispatch } = useApp();

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
            <div className="genre-card-name">{mix.title}</div>
            <div className="mix-card-desc">{mix.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
