import type { LibrarySort } from "@musex/core";

/** Map our sort enum to Plex's `sort` query field.
 *  NOTE: the exact Plex sort field strings are confirmed in Task 2 against
 *  context7/@ctrl/plex docs. Starting values from plan (adjust in Task 2 if needed). */
export function plexSort(sort: LibrarySort): string {
  switch (sort) {
    case "title":
      return "titleSort";
    case "artist":
      return "artist.titleSort";
    case "added":
      return "addedAt:desc";
  }
}
