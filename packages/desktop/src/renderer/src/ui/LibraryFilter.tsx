/** Browse-grid availability filter. Mirrors SortSelector's markup/styling
 *  (shared `.sort-select` class). The hosting view owns the selected mode. */
export type LibraryFilterMode = "all" | "downloaded" | "acquiring";

const OPTIONS: { value: LibraryFilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "downloaded", label: "Downloaded" },
  { value: "acquiring", label: "Acquiring" },
];

export function LibraryFilter({
  value,
  onChange,
}: {
  value: LibraryFilterMode;
  onChange: (m: LibraryFilterMode) => void;
}) {
  return (
    <select
      className="sort-select library-filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value as LibraryFilterMode)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
