// Host globals the pure @musex/core relies on (see packages/core/src/globals.d.ts):
// URL (four members) and structuredClone. Hermes lacks a full URL implementation
// and historically lacked structuredClone. Import this FIRST, before any core code.
import "react-native-url-polyfill/auto";

if (typeof globalThis.structuredClone !== "function") {
  // Minimal structured clone sufficient for core's plain-data models.
  globalThis.structuredClone = (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
