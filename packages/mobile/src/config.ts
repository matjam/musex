// Product identity sent in every Plex request. Kept dependency-free (no native
// Expo module imports) so the pure logic that consumes it stays unit-testable
// under vitest/node. The version is a static string for Phase 1; wiring it to
// the real app version (expo-constants) is an app-runtime concern, not pure logic.
export const PLEX_PRODUCT = "musex";
export const PLEX_VERSION = "0.0.1";
export const PLEX_PLATFORM = "iOS";
export const PLEX_DEVICE = "iOS";
