# iOS Device Distribution (dev client via EAS internal distribution) — Design

**Date:** 2026-06-16
**Status:** Approved in conversation (paid Apple account · EAS internal distribution · dev-client on device first)

Get `@musex/mobile` onto the user's **physical iPhone** for testing — **not** an
App Store release. A **development-client** build distributed via **EAS internal
distribution** (ad-hoc), so the same Metro fast-refresh loop that works on the
Simulator runs on real hardware.

## Decided approach

| Decision | Choice |
|---|---|
| Mechanism | **EAS internal distribution** (cloud build → ad-hoc-signed, install via QR/link on registered devices) |
| Build type | **Dev client** (`developmentClient: true`) — JS loads from the dev's Metro; iterate without rebuilding |
| Apple account | **Paid Apple Developer Program** (required for ad-hoc device registration) |
| Credentials | **EAS-managed** (auto-creates iOS distribution cert + ad-hoc provisioning profile) |

## Artifacts (in `packages/mobile/`)

- **`eas.json`** (committed): `cli.appVersionSource: "local"`; profiles —
  - `development`: `developmentClient: true`, `distribution: "internal"`, `ios.simulator: false` (the one we build now);
  - `preview`: `distribution: "internal"` (self-contained build, for later untethered testing);
  - `production`: `autoIncrement: true` (store build, placeholder — unused now).
- **`app.json`**: `eas init` adds `extra.eas.projectId` + `owner` (NOT yet present).

## Setup flow

All `eas` commands run **from `packages/mobile/`** (running from the repo root
made EAS write a stray `{"expo":{}}` at the root — already cleaned up).

1. `eas login` — Expo account (free). Run once in the user's terminal; it stores
   a machine session that subsequent commands (incl. agent-run) reuse.
2. `eas init` — links/creates the Expo project `@<owner>/musex`, writes
   `projectId`/`owner` into `packages/mobile/app.json`.
3. `eas device:create` — register the iPhone (website/URL method → open on the
   phone → install profile; needs Apple auth). Enable iOS Developer Mode on the
   device.
4. `eas build --profile development --platform ios` — cloud build; EAS handles
   Apple credentials (cert + ad-hoc profile incl. registered devices). Produces
   an install QR/link.
5. Install on the iPhone via the link; then `expo start --dev-client` on the Mac
   (same Wi-Fi, or `--tunnel`) → the dev client loads JS with fast refresh.

## Execution division (agent vs user)

- **Agent runs:** writes `eas.json`; `eas init`, `eas build`, and other
  Expo-side commands (after the user's one-time `eas login` establishes the
  machine session); reads/acts on all output.
- **User must do (unavoidable):** `eas login` (password); any **Apple sign-in +
  2FA**; all **physical-phone** steps (open registration link, install profile,
  Developer Mode, install the build).
- **Apple-auth option (user picks):** (a) user runs the 1–2 Apple-touching
  commands and enters 2FA, or (b) user sets up an **App Store Connect API key**
  (issuer id + key id + `.p8`) so EAS does all Apple/Developer-Portal automation
  non-interactively — agent then drives the entire flow; also reusable for CI.

## Monorepo / build notes

- EAS auto-detects the pnpm workspace (from `pnpm-workspace.yaml` + lockfile) and
  installs from the repo root, resolving `@musex/core` (`workspace:*`). Run
  `eas build` from `packages/mobile/`. **Verify the first build resolves core.**
- The committed **Metro `.js`→`.ts` resolver** (`metro.config.js`) runs on EAS's
  bundler too (dev client loads JS from the dev's Metro at runtime, so the
  resolver runs on the dev machine; a `preview`/`production` build bundles via
  the same committed config).
- `expo prebuild` outputs stay gitignored; EAS prebuilds fresh from `app.json`.

## Cost

EAS free tier: limited/queued iOS builds. A dev-client build is infrequent (only
when native deps change — JS iterates via Metro for free). Fallbacks if the queue
drags: a paid EAS plan, or local Xcode builds from the committed `ios/` project.

## Out of scope

App Store / TestFlight submission, the `preview`/`production` builds themselves
(profiles are scaffolded but unused), OTA updates (`expo-updates`), Android.

## Done when

The dev client installs on the user's iPhone, connects to Metro, and the full
sign-in → browse → play flow works on hardware (parity with the Simulator).
