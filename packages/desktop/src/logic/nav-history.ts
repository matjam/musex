/** Pure back/forward navigation history. The app reducer owns the state;
 *  these helpers keep the arithmetic testable. Views are plain serializable
 *  objects, compared structurally. */

export interface NavHistory<V> {
  back: V[];
  forward: V[];
}

export const EMPTY_HISTORY: NavHistory<never> = { back: [], forward: [] };

const MAX_BACK = 50;

/** Structural view equality (views are small, serializable objects). */
export function sameView(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Record a navigation away from `current`: push it onto back, drop the
 *  forward stack (a new branch of history), cap the depth. */
export function pushView<V>(h: NavHistory<V>, current: V): NavHistory<V> {
  return { back: [...h.back, current].slice(-MAX_BACK), forward: [] };
}

export function goBack<V>(
  h: NavHistory<V>,
  current: V,
): { history: NavHistory<V>; view: V } | null {
  const view = h.back[h.back.length - 1];
  if (view === undefined) return null;
  return {
    view,
    history: { back: h.back.slice(0, -1), forward: [...h.forward, current] },
  };
}

export function goForward<V>(
  h: NavHistory<V>,
  current: V,
): { history: NavHistory<V>; view: V } | null {
  const view = h.forward[h.forward.length - 1];
  if (view === undefined) return null;
  return {
    view,
    history: { back: [...h.back, current], forward: h.forward.slice(0, -1) },
  };
}
