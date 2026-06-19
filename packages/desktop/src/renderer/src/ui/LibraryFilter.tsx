/** Browse-grid filter. Mirrors SortSelector's markup/styling (shared
 *  `.sort-select` class). The hosting view owns the selected mode and which
 *  modes to offer (`modes` — e.g. Albums omits "watching", which is
 *  artist-level). */
export type LibraryFilterMode = "all" | "downloaded" | "watching";

const LABELS: Record<LibraryFilterMode, string> = {
  all: "All",
  downloaded: "Downloaded",
  // `watching` is the internal mode key; the user-facing vocabulary is "Following".
  watching: "Following",
};

const ALL_MODES: LibraryFilterMode[] = ["all", "downloaded", "watching"];

export function LibraryFilter({
  value,
  onChange,
  modes = ALL_MODES,
}: {
  value: LibraryFilterMode;
  onChange: (m: LibraryFilterMode) => void;
  /** Which modes to render (in order). Defaults to all three. */
  modes?: LibraryFilterMode[];
}) {
  return (
    <select
      className="sort-select library-filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value as LibraryFilterMode)}
    >
      {modes.map((m) => (
        <option key={m} value={m}>
          {LABELS[m]}
        </option>
      ))}
    </select>
  );
}
