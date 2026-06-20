# iOS TestFlight CI — design (2026-06-20)

Automate iOS TestFlight builds the same way the desktop platforms are built: a
job in `release-please.yml` that fires on a release-please release (or manual
dispatch), builds a signed `.ipa`, and uploads it to App Store Connect →
TestFlight. No human steps after the one-time bootstrap.

## Why this shape

- **iOS isn't a downloadable artifact.** Apple's signing/provisioning locks
  installation to the App Store / TestFlight, so the job does `eas submit`
  instead of `gh release upload`. Testers install via the TestFlight app.
- **`eas build --local` on `macos-latest`.** iOS builds require Xcode (macOS
  only). The repo is PUBLIC, so macOS runners are free + unlimited (no 10x
  minute multiplier). `--local` runs the build ON the runner, consuming **zero
  EAS cloud build credits** (the free tier's 15/mo is untouched).
- **EAS holds the credentials; CI needs one secret.** The bootstrap created and
  stored on EAS servers: (1) the iOS Distribution certificate + provisioning
  profile, and (2) an App Store Connect API key (`Key Source: EAS servers`).
  CI authenticates to EAS with `EXPO_TOKEN` and EAS applies both. So the only
  GitHub secret required is **`EXPO_TOKEN`** — no `.p8`, key IDs, or issuer IDs
  in the repo or in GitHub secrets.

## Versioning

iOS has two version fields; they are sourced independently:

- **Marketing version** (`expo.version` → CFBundleShortVersionString) — synced
  to the release version by **release-please** via a new `extra-files` entry
  (`packages/mobile/app.json` `$.expo.version`), alongside the existing
  `packages/desktop/package.json` sync. Every release commit bumps it, committed
  in the repo. TestFlight shows e.g. `0.16.5`, matching the GitHub release.
- **Build number** (`expo.ios.buildNumber` → CFBundleVersion) — set in CI to
  `github.run_number` (monotonic, globally unique) via a `jq` patch of
  `app.json` before the build. Apple only requires it to be unique + increasing
  within a marketing version.

`eas.json` keeps `cli.appVersionSource: "local"` with **no** `autoIncrement`.
Remote versioning / `autoIncrement` are not relied on because they do not
reliably bump for `eas build --local` (and `local` + `autoIncrement` is the
documented CI footgun — ephemeral runners never persist the bump → duplicate
build numbers). The deterministic `run_number` patch sidesteps both.

## Config changes (committed)

- `packages/mobile/eas.json`: `production` profile emptied to `{}` (default
  `store` distribution → App Store `.ipa`; `autoIncrement` removed);
  `submit.production.ios.ascAppId = "6782393824"` (public App Store Connect app
  id, makes non-interactive submit deterministic).
- `packages/mobile/app.json`: `expo.version` aligned to the current release line
  (`0.16.4`); `expo.ios.buildNumber` overwritten per-build in CI.
- `release-please-config.json`: `app.json` added to `extra-files`.

## The `build-ios` job (in `release-please.yml`)

Gated identically to `build-macos`/`build-linux`/`build-windows`
(`always() && (release_created == 'true' || workflow_dispatch)`), `runs-on:
macos-latest`:

1. checkout → pnpm setup → setup-node 24 → `pnpm install --frozen-lockfile`
   (full workspace; `eas build --local` runs Metro, which resolves `@musex/core`
   from source through the hoisted layout)
2. `npm install -g eas-cli`
3. `jq` patch `app.json` build number = `$GITHUB_RUN_NUMBER`
4. `eas build --local --platform ios --profile production --non-interactive
   --output "$RUNNER_TEMP/musex.ipa"` (auth via `EXPO_TOKEN`; pulls signing
   creds; prebuild + pod install + xcodebuild on the runner)
5. `eas submit --platform ios --profile production --path "$RUNNER_TEMP/musex.ipa"
   --non-interactive` → App Store Connect → TestFlight (reuses the EAS-stored
   ASC API key + `ascAppId`)

## One-time bootstrap (DONE 2026-06-20, interactively)

- EAS-managed signing credentials generated + stored (Distribution cert serial
  `5330B433…`, provisioning profile `9V8GLGT6HG`, team `YE8T4XGM2E`).
- App Store Connect app record created (`ascAppId 6782393824`, auto-named
  `musex (9f43f9)` — the public name "musex" is reserved by another developer;
  irrelevant to TestFlight, a public-launch decision later).
- ASC API key generated (App Manager role) + stored on EAS servers.
- First build (`0.0.1` build 2) submitted + installed via TestFlight internal
  testing.

## Remaining manual step

- Create an **`EXPO_TOKEN`** robot access token on expo.dev for `stupendous-net`
  and add it as a GitHub repository secret. (Only secret the workflow needs.)

## Risks / verify on first CI run

- **`eas build --local` + pnpm monorepo** under the runner's checkout — same
  hoisted-workspace resolution that's the watch-point everywhere; first run is
  the shakeout.
- **Xcode version on `macos-latest`** for RN 0.85 / Expo SDK 56 — pin via
  `maxim-lobanov/setup-xcode` if the default image's Xcode is incompatible.
- **`eas submit` reusing the EAS-stored ASC key non-interactively** — expected
  behavior (key source is EAS servers); confirm on first run.

## Non-goals

- Android / Play Store (no Android target yet).
- Path-filtered triggering (every release rebuilds iOS, matching the desktop
  jobs); add a `packages/mobile` filter later if build-number churn matters.
- Public App Store release (name conflict, screenshots, review) — testing only.
