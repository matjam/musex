/** Deterministic djb2-style string hash (same scheme as AlbumArt's gradient). */
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Deterministic pseudo-random sample of up to `count` thumbs for a collage.
 * Undefined/empty entries are dropped; if `count` or fewer remain they are all
 * returned in input order. Otherwise picks without replacement using a simple
 * LCG seeded from `seed` (djb2 hash), so the same inputs always produce the
 * same collage while different seeds (genres, mixes) get different selections.
 */
export function sampleThumbs(
  thumbs: (string | undefined)[],
  count: number,
  seed: string,
): string[] {
  const pool = thumbs.filter((t): t is string => typeof t === "string" && t !== "");
  if (pool.length <= count) return pool;
  // LCG state; `|| 1` guards against a zero hash stalling the generator.
  let state = hashSeed(seed) || 1;
  const out: string[] = [];
  while (out.length < count) {
    // Numerical Recipes LCG constants, kept in uint32.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const picked = pool.splice(state % pool.length, 1)[0];
    if (picked !== undefined) out.push(picked);
  }
  return out;
}
