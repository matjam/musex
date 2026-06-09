import type { LibrarySort } from "@musex/core";

const OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "added", label: "Recently added" },
];

export function SortSelector({
  value,
  onChange,
}: {
  value: LibrarySort;
  onChange: (s: LibrarySort) => void;
}) {
  return (
    <select
      className="sort-select"
      value={value}
      onChange={(e) => onChange(e.target.value as LibrarySort)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
