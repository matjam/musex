import { externalArtistRef } from "@musex/core";
import { BellRing, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AcquisitionStatusDto, ExpansionStateDto } from "../../../../shared/ipc-contract";
import { useFollow } from "../../state/follow";
import { EntityLink } from "../discovery/EntityLink";
import { StateBadge } from "../discovery/StateBadge";
import type { AcquisitionBadgeState } from "../discovery/state-badge";

const REFRESH_MS = 10_000;

/** Expansion entries carry their own lifecycle states (suggested/requested/
 *  landed/abandoned/rejected). Map the ones with an acquisition-badge
 *  equivalent; suggested/abandoned/rejected have none → render a neutral chip
 *  with their own STATE_LABEL (a suggestion isn't a "Requested" download). */
const EXPANSION_BADGE: Record<string, AcquisitionBadgeState | undefined> = {
  landed: "downloaded",
  requested: "requested",
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; rows: AcquisitionStatusDto[] };

function provenanceLine(e: ExpansionStateDto["entries"][number]): string {
  const pct = `${Math.round(e.provenance.match * 100)}%`;
  if (e.provenance.hop === 2 && e.provenance.via) {
    return `a step beyond ${e.provenance.seed}, via ${e.provenance.via} · similarity ${pct}`;
  }
  return `because you listen to ${e.provenance.seed} · similarity ${pct}`;
}

const STATE_LABEL: Record<string, string> = {
  suggested: "Suggested",
  requested: "Requested",
  landed: "Landed",
  abandoned: "Abandoned",
  rejected: "Rejected",
};

/** Taste-expansion attempt feed: every bet with state, provenance and a
 *  "Not for me" escape hatch. Rendered above the provider download queue. */
function ExpansionsFeed({
  state,
  onReject,
}: {
  state: ExpansionStateDto | null;
  onReject: (artistName: string) => void;
}) {
  if (state === null || (!state.prefs.enabled && state.entries.length === 0)) return null;
  return (
    <>
      <h3 className="browse-title">Expansions</h3>
      <div className="browse-sub">
        Taste expansion bets — what musex tried to add and what landed.
        {state.lastSummary ? ` Last cycle: ${state.lastSummary.toLowerCase()}` : ""}
      </div>
      {state.entries.length === 0 ? (
        <div className="content-placeholder">
          Nothing tried yet — the next cycle will pick artists from your taste profile.
        </div>
      ) : (
        <div className="dl-list expansion-list">
          {state.entries.map((e) => (
            <div className="dl-row" key={`${e.artistName}:${e.albumTitle}:${e.createdAt}`}>
              <div className="dl-row-main">
                <div className="dl-row-title">
                  {e.albumTitle}
                  <span className="dl-row-artist">
                    {" — "}
                    <EntityLink entity={externalArtistRef(e.artistName)}>{e.artistName}</EntityLink>
                  </span>
                  {e.deepening && <span className="expansion-deepening"> · deepening</span>}
                </div>
                <div className="dl-row-detail">{e.note ?? provenanceLine(e)}</div>
              </div>
              {EXPANSION_BADGE[e.state] ? (
                <StateBadge state={EXPANSION_BADGE[e.state] as AcquisitionBadgeState} />
              ) : (
                <span className="dl-chip">{STATE_LABEL[e.state] ?? e.state}</span>
              )}
              {e.state !== "rejected" && (
                <button
                  type="button"
                  className="expansion-reject"
                  title={`Not for me — never suggest ${e.artistName} again`}
                  onClick={() => onReject(e.artistName)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Status of requested/downloading albums across acquisition providers
 *  (e.g. an acquisition plugin queue + monitored-but-missing), the
 *  taste-expansion feed, and the artists watched for new releases.
 *  Auto-refreshes while open. */
export function AcquiringView() {
  const { isFollowed, setFollowed } = useFollow();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [expansion, setExpansion] = useState<ExpansionStateDto | null>(null);
  // Names (original casing) for the watched list; visibility is gated live by
  // the follow store so the X button (unfollow) updates optimistically.
  const [watchedNames, setWatchedNames] = useState<string[]>([]);

  const refresh = useCallback(() => {
    window.musex
      .acquisitionStatus()
      .then((rows) => setFetch({ status: "ok", rows }))
      .catch((err: unknown) => {
        console.error("[acquisition] status failed:", err);
        // Keep showing the last good rows; only surface the error before
        // the first successful fetch.
        setFetch((prev) =>
          prev.status === "ok"
            ? prev
            : {
                status: "error",
                message: err instanceof Error ? err.message : "Failed to load downloads",
              },
        );
      });
    window.musex
      .expansionGetState()
      .then(setExpansion)
      .catch((err: unknown) => console.error("[expansion] state failed:", err));
    window.musex
      .newReleaseWatchList()
      .then(setWatchedNames)
      .catch((err: unknown) => console.error("[watch] list failed:", err));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function reject(artistName: string) {
    void window.musex
      .expansionReject(artistName)
      .then(refresh)
      .catch((err: unknown) => console.error("[expansion] reject failed:", err));
  }

  function unwatch(artistName: string) {
    void setFollowed(externalArtistRef(artistName), false).catch((err: unknown) =>
      console.error("[follow] unfollow failed:", err),
    );
  }

  // Live view: hide names the store no longer considers followed (optimistic
  // unfollow), so the list updates without waiting for the next refresh.
  const watched = watchedNames.filter((name) => isFollowed(externalArtistRef(name)));

  return (
    <div className="browse-section downloads-view">
      <ExpansionsFeed state={expansion} onReject={reject} />

      <h3 className="browse-title">Downloads</h3>
      <div className="browse-sub">Albums requested through acquisition plugins.</div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.rows.length === 0 && (
        <div className="content-placeholder">
          Nothing requested. Add albums from an external artist's page.
        </div>
      )}

      {fetch.status === "ok" && fetch.rows.length > 0 && (
        <div className="dl-list">
          {fetch.rows.map((row) => (
            <div className="dl-row" key={`${row.providerId}:${row.artistName}:${row.title}`}>
              <div className="dl-row-main">
                <div className="dl-row-title">
                  {row.title}
                  <span className="dl-row-artist">
                    {" — "}
                    <EntityLink entity={externalArtistRef(row.artistName)}>
                      {row.artistName}
                    </EntityLink>
                  </span>
                </div>
                {row.progress != null && (
                  <div className="dl-progress">
                    <div
                      className="dl-progress-fill"
                      style={{
                        width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {row.detail && <div className="dl-row-detail">{row.detail}</div>}
              </div>
              <StateBadge
                state={row.state}
                percent={
                  row.state === "downloading" && row.progress != null
                    ? row.progress * 100
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}

      {watched.length > 0 && (
        <>
          <h3 className="browse-title watched-title">Watching for new releases</h3>
          <div className="browse-sub">
            Future albums by these artists are fetched automatically.
          </div>
          <div className="dl-list">
            {watched.map((name) => (
              <div className="dl-row" key={name}>
                <div className="dl-row-main">
                  <div className="dl-row-title">
                    <BellRing size={13} className="watched-icon" /> {name}
                  </div>
                </div>
                <button
                  type="button"
                  className="expansion-reject"
                  title={`Stop watching ${name}`}
                  onClick={() => unwatch(name)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
