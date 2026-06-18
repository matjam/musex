/** Up-next count at/below which radio tops up. */
export const RADIO_TOPUP_THRESHOLD = 5;
/** Consecutive empty top-ups before radio auto-stops. */
const RADIO_MAX_EMPTY_ROUNDS = 2;

export interface RadioState {
  active: boolean;
  /** Consecutive top-ups that found nothing playable. */
  emptyRounds: number;
}

/** Stable key for exclude-set membership (case/space-insensitive). */
export function radioKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}␟${title.trim().toLowerCase()}`;
}

/** Top up when active and fewer than the threshold remain up next. */
export function shouldTopUp(state: RadioState, upNextCount: number): boolean {
  return state.active && upNextCount < RADIO_TOPUP_THRESHOLD;
}

/** After a top-up that appended `added` tracks: reset on progress, else count
 *  the empty round and stop after the cap. */
export function advanceRadio(state: RadioState, added: number): RadioState {
  if (added > 0) return { active: true, emptyRounds: 0 };
  const emptyRounds = state.emptyRounds + 1;
  return { active: emptyRounds < RADIO_MAX_EMPTY_ROUNDS, emptyRounds };
}
