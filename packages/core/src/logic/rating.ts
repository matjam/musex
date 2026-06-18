/** Plex stores ratings on a 0–10 scale; the UI shows 0–5 stars. These convert
 *  between the two. (LOVED_RATING = 8 = 4 stars; see smart-playlists.) */

/** 0–10 Plex rating (or null/unrated) → 0–5 whole stars. */
export function starsFromRating10(rating10: number | null): number {
  if (rating10 == null || rating10 <= 0) return 0;
  return Math.round(rating10 / 2);
}

/** 0–5 whole stars → 0–10 Plex rating. */
export function rating10FromStars(stars: number): number {
  return stars * 2;
}
