/**
 * Maps a fully-namespaced plugin secret key (e.g.
 * `musex.plugin-secret:<pluginId>:<key>`) to a SecureStore-legal key.
 *
 * SecureStore keys allow only `[A-Za-z0-9._-]`. The previous approach replaced
 * every illegal char with `_`, which is LOSSY: `set("x:y")` and `set("x_y")`
 * collapsed to the same store key (silent overwrite). We instead hash the full
 * namespaced key with sha256 (hex → `[a-f0-9]`, SecureStore-legal) so distinct
 * inputs map to distinct keys, and the same input is stable across calls. The
 * pluginId is part of the namespaced input, so two plugins never collide.
 */

const PREFIX = "musex.plugin-secret";

/** Build an injective SecureStore key from a namespaced secret key + a hex
 *  sha256 hasher. */
export function secretStoreKey(namespacedKey: string, sha256: (input: string) => string): string {
  return `${PREFIX}.${sha256(namespacedKey)}`;
}
