// Stable-per-process Plex client identifier. Phase 1 accepts a fresh id per
// launch (create-pin + poll-pin happen within a single session); persisting it
// across launches via SecureStore is a later refinement. It is NOT a secret, so
// a Math.random-based UUID is sufficient — no native crypto dependency needed.
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const CLIENT_ID = `musex-ios-${uuid()}`;
