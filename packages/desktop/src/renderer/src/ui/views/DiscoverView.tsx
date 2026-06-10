import { useEffect, useState } from "react";
import type { SectionDto } from "../../../../shared/ipc-contract";
import { PluginSections } from "../PluginSections";

/** Plugin-driven discovery: sections contributed to the "discover" target
 *  (e.g. last.fm "Because you listened to X" similar-artist rows). */
export function DiscoverView() {
  // null = loading; [] = nothing contributed.
  const [sections, setSections] = useState<SectionDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .sectionsGet("discover")
      .then((s) => {
        if (!cancelled) setSections(s);
      })
      .catch((err) => {
        console.error("[discover] failed to load sections:", err);
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nonEmpty = sections?.filter((s) => s.items.length > 0) ?? [];

  return (
    <div className="browse-section discover-view">
      <h2 className="home-greeting">Discover</h2>
      {sections === null && <div className="content-placeholder">Looking for suggestions…</div>}
      {sections !== null && nonEmpty.length === 0 && (
        <div className="content-placeholder">
          No discovery providers are enabled — enable a plugin in Settings.
        </div>
      )}
      {nonEmpty.length > 0 && <PluginSections sections={nonEmpty} />}
    </div>
  );
}
