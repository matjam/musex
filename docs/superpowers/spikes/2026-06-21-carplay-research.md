# Spike: CarPlay (audio app) for the iOS app — research findings

**Date:** 2026-06-21
**Status:** research only — CarPlay is GATED on Apple granting `com.apple.developer.carplay-audio` (request submitted 2026-06-21). Arc order: Downloads v2 → iPad → CarPlay.

## Verdict

**Hand-roll a local Swift Expo module (the `lock-screen-commands` pattern); do NOT adopt `react-native-carplay`.**

## Why not react-native-carplay

- Its README states "**No Expo support due to Scenes**"; the only community Expo config plugin targets v2.3.0 + the OLD architecture and is unmaintained. A custom config plugin (scene manifest + entitlement) is required **either way**.
- Stable release is 3+ years old (2.3.0, 2023); the one "New Architecture Ready" fork (`@g4rb4g3/…`) is **archived** and caps at RN 0.79 peer-deps (we're on RN 0.85). `@iternio/react-native-auto-play` is fresh (2026-07) but unverified against 0.85/Expo.
- **The killer: headless launch.** CarPlay can connect while the phone app is killed; react-native-carplay defines templates in JS, so the RN bridge must boot from the scene delegate — a documented, recurring blank-screen failure class (facebook/react-native#41777, birkir#154/#199) with only fragile workarounds.

## The hand-rolled design shape

- A native `CPTemplateApplicationSceneDelegate` (audio-app template set: CPTabBarTemplate → CPListTemplate; Now Playing is SYSTEM-rendered) building the browse tree **natively from locally-cached data** — works with JS dead.
- **Now Playing is already fed for free:** expo-audio 56's `MediaController.swift` drives `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` (verified in installed source); our `setNowPlaying()`/lock-screen path populates it today. Transport controls in-car (Bluetooth AVRCP + CarPlay Now Playing) ride the same handlers — play/pause native, next/prev via `lock-screen-commands` (JS-hop caveat: fine while playing; a long-paused suspended app may drop a next/prev until wake — moving queue-advance native is part of the CarPlay work).
- A thin bridge (Events/OnStartObserving shape) syncs browse data + forwards play intents when JS is up; a native play path covers headless.
- `MPPlayableContentManager` is deprecated (iOS 14+) — CarPlay framework templates are the only current path. With the audio entitlement: template-set-only, no custom UI.
- Entitlement is a **managed capability**: Apple grants against the App ID → regenerate provisioning profile → entitlements file via the same custom config plugin; EAS-managed credentials must pick up the new profile. Required for TestFlight/App Store.

## Open questions to resolve at design time

1. **Does the Xcode 26 CarPlay simulator render templates WITHOUT the granted entitlement?** Sources conflict (dev lore: yes; other guides: needs a CarPlay-capable provisioning profile). Cheap empirical test: scene manifest + stub CPTabBarTemplate → Simulator → I/O → External Displays → CarPlay.
2. **Native readability of the browse data:** the Downloaded tab source is `DownloadIndex` (AsyncStorage `musex.downloads-index`); Playlists/Albums/Artists come from `MobileListCache` (expo-file-system JSON files, sha256-keyed, `getStale()` offline-serve). Both are plausibly Swift-readable in place (AsyncStorage's iOS backing store; plain JSON files) — verify, else add a small native-written mirror the JS side maintains.
3. **Browse-tree model in core** (pure `logic/media-browse-tree.ts`) so a future Android Auto surface reuses it.

Full sources + version details in the research transcript; key refs: birkir/react-native-carplay#101 (Expo plugin issue), Apple "Requesting CarPlay Entitlements", WWDC20 "Accelerate your app with CarPlay".
