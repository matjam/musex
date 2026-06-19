import { externalArtistRef } from "@musex/core";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ExpansionStateDto } from "../../../../shared/ipc-contract";
import { EntityLink } from "../discovery/EntityLink";
import { StateBadge } from "../discovery/StateBadge";
import type { AcquisitionBadgeState } from "../discovery/state-badge";

const REFRESH_MS = 10_000;
/** "Recently acquired" window: expansion entries that landed in the last 14 days. */
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Expansion entries carry their own lifecycle states (suggested/requested/
 *  landed/abandoned/rejected). Map the ones with an acquisition-badge
 *  equivalent; suggested/abandoned/rejected have none → render a neutral chip
 *  with their own STATE_LABEL (a suggestion isn't a "Requested" download). */
const EXPANSION_BADGE: Record<string, AcquisitionBadgeState | undefined> = {
  landed: "downloaded",
  requested: "requested",
};

const STATE_LABEL: Record<string, string> = {
  suggested: "Suggested",
  requested: "Requested",
  landed: "Landed",
  abandoned: "Abandoned",
  rejected: "Rejected",
};

function provenanceLine(e: ExpansionStateDto["entries"][number]): string {
  const pct = `${Math.round(e.provenance.match * 100)}%`;
  if (e.provenance.hop === 2 && e.provenance.via) {
    return `a step beyond ${e.provenance.seed}, via ${e.provenance.via} · similarity ${pct}`;
  }
  return `because you listen to ${e.provenance.seed} · similarity ${pct}`;
}

/** One album row (used by both the Recently-acquired and Taste-expansion feeds). */
function ExpansionRow({
  entry,
  onReject,
}: {
  entry: ExpansionStateDto["entries"][number];
  onReject?: (artistName: string) => void;
}) {
  return (
    <div className="dl-row">
      <div className="dl-row-main">
        <div className="dl-row-title">
          {entry.albumTitle}
          <span className="dl-row-artist">
            {" — "}
            <EntityLink entity={externalArtistRef(entry.artistName)}>{entry.artistName}</EntityLink>
          </span>
          {entry.deepening && <span className="expansion-deepening"> · deepening</span>}
        </div>
        <div className="dl-row-detail">{entry.note ?? provenanceLine(entry)}</div>
      </div>
      {EXPANSION_BADGE[entry.state] ? (
        <StateBadge state={EXPANSION_BADGE[entry.state] as AcquisitionBadgeState} />
      ) : (
        <span className="dl-chip">{STATE_LABEL[entry.state] ?? entry.state}</span>
      )}
      {onReject && entry.state !== "rejected" && (
        <button
          type="button"
          className="expansion-reject"
          title={`Not for me — never suggest ${entry.artistName} again`}
          onClick={() => onReject(entry.artistName)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** The activity feed, scoped to the data that actually carries a real
 *  timestamp:
 *
 *  1. "Recently acquired" — expansion entries that LANDED in the last 14 days.
 *     This is the only acquisition data with a real timestamp. General Lidarr
 *     grabs (the `acquisitionStatus()` queue) carry NO timestamp, so they are
 *     deliberately NOT shown here — they would otherwise read as perpetually
 *     "acquiring" with no way to tell what's new (a known acquisition-provider
 *     limitation).
 *  2. "Taste Expansion" — the in-progress bets / provenance, as before.
 *
 *  Reachable from the persistent sidebar "Activity" entry. Auto-refreshes. */
export function ActivityView() {
  const [expansion, setExpansion] = useState<ExpansionStateDto | null>(null);

  const refresh = useCallback(() => {
    window.musex
      .expansionGetState()
      .then(setExpansion)
      .catch((err: unknown) => console.error("[expansion] state failed:", err));
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

  const entries = expansion?.entries ?? [];
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  // Newest-first. expansionGetState already returns newest-first, but landedAt
  // (not createdAt) is the relevant time here, so sort explicitly.
  const recentlyAcquired = entries
    .filter((e) => e.state === "landed" && e.landedAt != null && e.landedAt > cutoff)
    .sort((a, b) => (b.landedAt ?? 0) - (a.landedAt ?? 0));

  const expansionVisible =
    expansion !== null && (expansion.prefs.enabled || expansion.entries.length > 0);

  return (
    <div className="browse-section downloads-view">
      <h3 className="browse-title">Recently acquired</h3>
      <div className="browse-sub">Albums that landed on your server in the last 14 days.</div>
      {recentlyAcquired.length === 0 ? (
        <div className="content-placeholder">Nothing landed recently.</div>
      ) : (
        <div className="dl-list">
          {recentlyAcquired.map((e) => (
            <ExpansionRow key={`${e.artistName}:${e.albumTitle}:${e.landedAt}`} entry={e} />
          ))}
        </div>
      )}

      {expansionVisible && (
        <>
          <h3 className="browse-title">Taste Expansion</h3>
          <div className="browse-sub">
            Taste expansion bets — what musex tried to add and what landed.
            {expansion.lastSummary ? ` Last cycle: ${expansion.lastSummary.toLowerCase()}` : ""}
          </div>
          {expansion.entries.length === 0 ? (
            <div className="content-placeholder">
              Nothing tried yet — the next cycle will pick artists from your taste profile.
            </div>
          ) : (
            <div className="dl-list expansion-list">
              {expansion.entries.map((e) => (
                <ExpansionRow
                  key={`${e.artistName}:${e.albumTitle}:${e.createdAt}`}
                  entry={e}
                  onReject={reject}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
