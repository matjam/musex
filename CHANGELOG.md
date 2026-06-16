# Changelog

## [0.8.1](https://github.com/matjam/musex/compare/v0.8.0...v0.8.1) (2026-06-16)


### Bug Fixes

* **arch:** repair broken /usr/bin/musex symlink and app-menu launcher ([#33](https://github.com/matjam/musex/issues/33)) ([aee7532](https://github.com/matjam/musex/commit/aee75323725530b6f71eab37ac56bb79e88c28af))

## [0.8.0](https://github.com/matjam/musex/compare/v0.7.0...v0.8.0) (2026-06-16)


### Features

* Linux hamburger menu + native Wayland, and fix release packaging ([#30](https://github.com/matjam/musex/issues/30)) ([c6c1ebb](https://github.com/matjam/musex/commit/c6c1ebbbe2a27800c5f6af13e2f4b435bce6a435))

## [0.7.0](https://github.com/matjam/musex/compare/v0.6.0...v0.7.0) (2026-06-16)


### Features

* linux build (AppImage + deb) ([#27](https://github.com/matjam/musex/issues/27)) ([35f38df](https://github.com/matjam/musex/commit/35f38dfdbf297ddca0a5558cf0dfa1758f9d534b))

## [0.6.0](https://github.com/matjam/musex/compare/v0.5.0...v0.6.0) (2026-06-11)


### Features

* categorized settings with per-plugin panes and in-app update check ([#24](https://github.com/matjam/musex/issues/24)) ([c3a81c5](https://github.com/matjam/musex/commit/c3a81c58dfe6eb55f406a9721b0723b42edb3cc6))

## [0.5.0](https://github.com/matjam/musex/compare/v0.4.0...v0.5.0) (2026-06-11)


### Features

* home and navigation polish, in-app artist discovery and acquisition ([#22](https://github.com/matjam/musex/issues/22)) ([6580b08](https://github.com/matjam/musex/commit/6580b0877f8f42c375f970375f794ae608494956))

## [0.4.0](https://github.com/matjam/musex/compare/v0.3.0...v0.4.0) (2026-06-11)


### Features

* volume leveling and EQ presets ([#19](https://github.com/matjam/musex/issues/19)) ([b941321](https://github.com/matjam/musex/commit/b9413211590c1fbca7e2e1b4c1436a322b81735d))


### Bug Fixes

* pick up new Plex library items without a restart ([#21](https://github.com/matjam/musex/issues/21)) ([9434e8a](https://github.com/matjam/musex/commit/9434e8a07847ef851fbe512d4994b3c09cf22e66))

## [0.3.0](https://github.com/matjam/musex/compare/v0.2.2...v0.3.0) (2026-06-11)


### Features

* **ui:** app icon (lucide Disc3, brand gradient, dark squircle) ([#18](https://github.com/matjam/musex/issues/18)) ([7376b8a](https://github.com/matjam/musex/commit/7376b8a8b44c98193c17d49327815f006d715881))


### Bug Fixes

* **lidarr:** albums unmonitored by the initial artist refresh never downloaded ([#15](https://github.com/matjam/musex/issues/15)) ([0bec8cb](https://github.com/matjam/musex/commit/0bec8cb02890ae798ed970a19424a50c123fe487))

## [0.2.2](https://github.com/matjam/musex/compare/v0.2.1...v0.2.2) (2026-06-11)


### Bug Fixes

* **updater:** read-only vendored files broke every macOS auto-update ([#13](https://github.com/matjam/musex/issues/13)) ([8f59478](https://github.com/matjam/musex/commit/8f594787dde7c6314c5ea078b3a06d848326b2b5))

## [0.2.1](https://github.com/matjam/musex/compare/v0.2.0...v0.2.1) (2026-06-11)


### Bug Fixes

* **expansion:** transient Lidarr lookup failures must not blacklist artists ([#11](https://github.com/matjam/musex/issues/11)) ([665995c](https://github.com/matjam/musex/commit/665995cb08463a0fa1b686f3f7ec5d276635320d))

## [0.2.0](https://github.com/matjam/musex/compare/v0.1.3...v0.2.0) (2026-06-11)


### Features

* **expansion:** optimistic acquisition + per-artist new-release watching ([7cc4295](https://github.com/matjam/musex/commit/7cc42959e0e2ad0db68e415ed0c92f7e6443f688))
* **expansion:** release notes for [#7](https://github.com/matjam/musex/issues/7) (squash dropped conventional commits) ([024ff45](https://github.com/matjam/musex/commit/024ff458983640c8a0ae4063aedf0ff8501ead5c))

## [0.1.3](https://github.com/matjam/musex/compare/v0.1.2...v0.1.3) (2026-06-10)


### Features

* **ui:** About window with full dependency attribution; add README + MIT LICENSE ([8982bf0](https://github.com/matjam/musex/commit/8982bf08b4ae239ea7e4bd4921e4720b5a767e4f))

## [0.1.2](https://github.com/matjam/musex/compare/v0.1.1...v0.1.2) (2026-06-10)


### Features

* album/artist art via musex-stream proxy (token-safe) with gradient fallback ([0c6aacb](https://github.com/matjam/musex/commit/0c6aacb7f38a16d87abd037e6e4b03d8e7783b7b))
* **albums:** library-wide Albums view with sort + cache; cache Artists list ([48bc9ab](https://github.com/matjam/musex/commit/48bc9abb504d83a6d4565dbea03063623c452b78))
* **art-cache:** isArtPath + sniffImageType helpers ([f112ea0](https://github.com/matjam/musex/commit/f112ea0bb3f1b445f221e85408b0570f88900ddb))
* **art-cache:** proxy serves/writes art through an always-on disk cache (+ immutable Cache-Control) ([b77d698](https://github.com/matjam/musex/commit/b77d698e87157aa8460d12065cd8b966e7e35e78))
* **art-cache:** Settings cache size + Clear cover audio and art ([fe9efe9](https://github.com/matjam/musex/commit/fe9efe97d917a1204aaf133f44437663f9c1343a))
* **art-cache:** wire always-on art MediaCache into Runtime + proxy ([e0df22c](https://github.com/matjam/musex/commit/e0df22cc4bc3d7b72ffe848fa5e2fcd72c925169))
* **audio:** play watchdog retries a stalled track load ([07fe4cf](https://github.com/matjam/musex/commit/07fe4cf50c25e7f15eb760dd7540a71184b8d450))
* auto-restore Plex session on startup (skip sign-in when token persists) ([4e0c25f](https://github.com/matjam/musex/commit/4e0c25fa934145e8695d7a687ad80c6e29d817e1))
* **cache:** CachingPlexGateway decorator + wire into Runtime ([38e9976](https://github.com/matjam/musex/commit/38e9976c6b5bc75555f281d2f59c2110a10d7b55))
* **cache:** filesystem MediaCache adapter (write-through, LRU evict, clear) ([ca6efe6](https://github.com/matjam/musex/commit/ca6efe6e0c11b1d06b595e1308b0ed5c02c2eb83))
* **cache:** ListCacheStore (disk-persisted, validator-keyed, evicting) ([feff037](https://github.com/matjam/musex/commit/feff037a4e1d11ad5875d9ef3df436c6d6e50b9d))
* **cache:** map Plex updatedAt onto models + listValidator helper ([e5390ed](https://github.com/matjam/musex/commit/e5390edeebf03f9f0bf60d171b4b930394308ae6))
* **cache:** pass list validators from renderer through IPC (instant re-opens) ([6a01967](https://github.com/matjam/musex/commit/6a019677e2baf8588fc38ecddc5007e94db35709))
* **cache:** persistence fields + preference IPC contract + preload ([93309f5](https://github.com/matjam/musex/commit/93309f5fc5ee7258d53c286fb252d939790b80db))
* **cache:** progressive paged loading for long playlist tracks ([d5ce34b](https://github.com/matjam/musex/commit/d5ce34b102bf309c3ecd7353b35c081ab88fa1b2))
* **cache:** pure cache logic (key, range, content-type, LRU selection) ([819ca0c](https://github.com/matjam/musex/commit/819ca0c433d05be6e190110e039981416a36b0b6))
* **cache:** stream-proxy write-through + serve-from-disk (range-aware) ([3b8a1fe](https://github.com/matjam/musex/commit/3b8a1fe997a105765452c7fece7b9634afb5a709))
* **cache:** wire MediaCache into runtime + preference/cache IPC handlers ([29d1bc6](https://github.com/matjam/musex/commit/29d1bc625ba470fe2df0107f945dba8ad47500c2))
* **core:** add updatedAt to Artist/Album/Playlist for cache validation ([b961301](https://github.com/matjam/musex/commit/b961301a00c0e9cdff5a7785db9fbc860de249d5))
* **core:** LibrarySort, Library.updatedAt, listAllAlbums/listAllTracksPage port + fake ([386455c](https://github.com/matjam/musex/commit/386455cdd31ff791d8ca26227f054d410043781a))
* **core:** PlaybackSession.restore() — resume a saved queue paused at position ([9200f68](https://github.com/matjam/musex/commit/9200f6875c84bd07a9797b0295c6843295ab674d))
* **core:** playlist models, PlexGateway playlist ops, createPlaylist use-case ([124b3fb](https://github.com/matjam/musex/commit/124b3fb127ebbe769940fedcc9a0bd5413baa5b0))
* **core:** queue ops + shuffle + repeat in PlaybackSession (TDD) ([ba3960f](https://github.com/matjam/musex/commit/ba3960f7218d5f976a0cae021a8a503ea3eb634e))
* **core:** RepeatMode + Queue shuffle/repeat fields ([0e5665a](https://github.com/matjam/musex/commit/0e5665af4db1d9cd28fac0c76131c5554eecb824))
* **core:** search model, PlexGateway.search port, searchLibrary use-case ([77bf796](https://github.com/matjam/musex/commit/77bf796079e01a7bf4b897fa7b4176765de0cb74))
* **core:** Track.artistId + PlaybackSession.playTrackNext (double-click play) ([313e8de](https://github.com/matjam/musex/commit/313e8deb1c901ee9f71f79442486f21c4ca75776))
* **desktop:** pure mpv JSON-IPC command builders + event mapper ([1184c2e](https://github.com/matjam/musex/commit/1184c2e1237136a9882d02e81fcd8f7ecbaa1b2c))
* **discover:** real last.fm artwork, proxied + cached through the art cache ([5ec6f0b](https://github.com/matjam/musex/commit/5ec6f0bfc9da3873b66fc131dc05ccb66e58e7f9))
* **genres:** genre index + per-genre dynamic playlists (cache v5) ([38fa4c9](https://github.com/matjam/musex/commit/38fa4c9b1893e50b9cb7e576b307c8f0d8c936c3))
* **ipc:** library-wide albums (cached) + paged tracks channels ([fa796dd](https://github.com/matjam/musex/commit/fa796dd4442a38feb33a3ca1d76007926a65b3a5))
* **ipc:** playlist channels (contract + preload + handlers with art baking) ([28cf88a](https://github.com/matjam/musex/commit/28cf88a77d32300da9fe8d9959ff50e8d5c82964))
* **ipc:** save/load playback state; normalize+re-bake art thumbs at the boundary ([1dbc475](https://github.com/matjam/musex/commit/1dbc4757469b04afcfb9d322b7d97a936e44462a))
* **ipc:** search channel (contract + preload + handler with art baking) ([1fb6695](https://github.com/matjam/musex/commit/1fb66957ca2601c1a81bb598454d2d29abdb8868))
* **lastfm:** last.fm plugin — auth, scrobbling, Love action (first dynamic plugin) ([0bafd11](https://github.com/matjam/musex/commit/0bafd1145ce346ec1672acf355dbea5d1f1488b7))
* **lidarr:** Allow self-signed certificates toggle (node:https transport) ([25c3791](https://github.com/matjam/musex/commit/25c3791845ba7ba2695a438f36bff10bfb8834fd))
* **lidarr:** Lidarr plugin — discography lookup, album acquisition, download status ([26bc2f1](https://github.com/matjam/musex/commit/26bc2f10b1826d6bd3fbe29e582005519a29e3a2))
* **main:** MpvController — vendored mpv over JSON IPC + playback IPC surface ([48c61f3](https://github.com/matjam/musex/commit/48c61f3ceca1c1ade89590ab9c677e2c727e913c))
* **main:** persist playback queue + cursor in separate stores; add parseProxyPath ([0fcb93a](https://github.com/matjam/musex/commit/0fcb93aff01dbc08f03e4cc799a45610939ec5f5))
* **menu:** application menu with Help — shortcuts, GitHub, issues, logs folder ([9bd7586](https://github.com/matjam/musex/commit/9bd758689395a98dbe1c8615d5133fea2f52ffd3))
* **mixes:** mood mixes — Driving/Workout/Chill/Coding from genre+mood tags, taste-ordered (cache v6) ([8f30105](https://github.com/matjam/musex/commit/8f30105f36723e43bbf66fcb713a5a3d96507de3))
* **perf:** virtualized track lists (@tanstack/react-virtual) ([e136651](https://github.com/matjam/musex/commit/e136651ce81e8236a34e2727bf09520a6f52bfba))
* **playlists:** playlist store, TrackRow menu trigger, TrackContextMenu ([a163e36](https://github.com/matjam/musex/commit/a163e36a2c73e4df121573f7ac71baa832397c5c))
* **playlists:** PlaylistView + add-to-playlist menu across album/search/playlist ([3589f6d](https://github.com/matjam/musex/commit/3589f6d91141df73ba3a55dd71a2daf4bf35f7b0))
* **playlists:** sidebar rail + New Playlist dialog (create flow) ([ddae800](https://github.com/matjam/musex/commit/ddae80004c20003b09331a9e50eb6f2dbd5e49c1))
* **playlists:** smart playlists — Top Rated, Heavy Rotation, Rediscover ([f934bca](https://github.com/matjam/musex/commit/f934bcaced59a66b1f91d50cea0bf45502857592))
* **plex:** implement library search (artists/albums/tracks) ([f267d48](https://github.com/matjam/musex/commit/f267d48263b6c67ce4f152eaebe81fa86227ffcd))
* **plex:** implement playlist CRUD (+ env-gated round-trip smoke test) ([6dba6f7](https://github.com/matjam/musex/commit/6dba6f76f9c9a373098ce0fdab3487c0c956c861))
* **plex:** library-wide listAllAlbums + paged listAllTracks + section updatedAt ([2adb473](https://github.com/matjam/musex/commit/2adb4737983bd309e2c1968770662d08f0ec273d))
* **plugins:** AcquisitionProvider extension point — lookup, acquire, status ([3d92c0a](https://github.com/matjam/musex/commit/3d92c0a1481d664ae96932509239034dad20200a))
* **plugins:** dynamic plugin host — manifest, loader, ctx kernel, settings UI ([6deeb26](https://github.com/matjam/musex/commit/6deeb2669c3f314d75461aace3db00a468e9c3fd))
* **plugins:** playback events pipeline — monitor, scrobble gate, ctx.events + ctx.library ([e9c5016](https://github.com/matjam/musex/commit/e9c5016b967bfc20f3e9d43c4ad30c6d24e1fe70))
* **plugins:** sections + Discover view + track actions/detail points; last.fm providers ([b5c8b03](https://github.com/matjam/musex/commit/b5c8b030d8cbb0c5e4b584a0253f0f6c01743dcb))
* **prefetch:** StreamProxy.prefetch warms upcoming tracks into the cache ([3ebe66f](https://github.com/matjam/musex/commit/3ebe66f229da779617fb05b440d6f1b3b3018793))
* **prefetch:** trigger upcoming-track prefetch from the player on queue change ([513178d](https://github.com/matjam/musex/commit/513178da2744ee3909f4e38e6c9e7fe3551384dc))
* **queue:** lucide transport icons + shuffle/repeat/queue controls ([9f8e2ea](https://github.com/matjam/musex/commit/9f8e2eaf8aa853bcd5dcd352805c4ae0d596c191))
* **queue:** Play next / Add to queue for tracks, albums, artists ([4f2da4f](https://github.com/matjam/musex/commit/4f2da4f29a4e60c863f98ad20f0fb920ec97bf8b))
* **queue:** right-side QueueDrawer with drag reorder + remove + clear ([a71c97c](https://github.com/matjam/musex/commit/a71c97c6e4d9975530de7d48923d7413cd690fac))
* **radio:** radio mode — seeded auto-extending queue, start from track/artist, queue-drawer control ([83f50e2](https://github.com/matjam/musex/commit/83f50e2c3e2042b37453d865a1a079ace9c15e9c))
* **radio:** TrackRecommender extension point, host-side resolution, last.fm recommender ([a704f47](https://github.com/matjam/musex/commit/a704f47ab83a7a3ef08cfc00231c0b6acb4cc58b))
* **ratings:** album ratings — Plex write, cache v4, stars on the album page ([2cd0a30](https://github.com/matjam/musex/commit/2cd0a30766635d82f683288bf3016c730e3c10fa))
* **ratings:** Plex userRating on tracks/artists — model, gateway rate/read, cache v3 + eviction, IPC ([3004d93](https://github.com/matjam/musex/commit/3004d93e20da2498aec2a3a08049b602f46519ed))
* **ratings:** trackRated plugin event; last.fm loves 4★+ tracks ([a4336c6](https://github.com/matjam/musex/commit/a4336c6281a2df1cc327b16d0796524f75b6a780))
* **release:** electron-builder DMG packaging + signed/notarized release CI with release-please (0.x) ([725b140](https://github.com/matjam/musex/commit/725b1403bd5feefb878ed64228acca6a80998574))
* **renderer:** IpcPlaybackEngine — playback now runs on vendored mpv ([4903b87](https://github.com/matjam/musex/commit/4903b87c98715ba9e07d54337c39594b1b8d6b6b))
* **renderer:** restore playback on launch; persist queue + cursor on change ([bab7cfe](https://github.com/matjam/musex/commit/bab7cfe0f3c4ba994163e6fe810ae004577d34bc))
* **search:** federated external search + monitor-entire-artist via Lidarr ([f02b67f](https://github.com/matjam/musex/commit/f02b67f34b87c998846112af141eb361b90b850f))
* **search:** live SearchView (grouped results) + working Search nav ([cab1433](https://github.com/matjam/musex/commit/cab14336cf7133b272740275ec1ef2eff62c2444))
* **settings:** sectioned Settings view with local-cache controls ([b83c9f4](https://github.com/matjam/musex/commit/b83c9f4a3e6ca33d5e8bed45e034bba867e8a5ca))
* **similar:** Similar panel for artists + songs — plugin point, last.fm provider, side panel UI ([d0917fa](https://github.com/matjam/musex/commit/d0917fa027fcd7a0d6ed4436cfcf0f71c651263e))
* **smart:** For You mix — taste + similar-owned resurfacing; listening stats in the track panel ([7b05ebd](https://github.com/matjam/musex/commit/7b05ebd13dc785c26d7f1797e77f3af86cb64c7c))
* **taste:** persisted listening profile — affinity scoring, decay, topArtists for plugins ([e650b54](https://github.com/matjam/musex/commit/e650b544b847803bea00952876aed27290fed9ae))
* **tracks:** cached full listAllTracks (mirrors listAllAlbums) ([8dbe134](https://github.com/matjam/musex/commit/8dbe1344cf2d6e7c8f93393c4e85798802bd92f2))
* **tracks:** library-wide Tracks view (virtualized, sortable, cached) ([a6cc636](https://github.com/matjam/musex/commit/a6cc63674057d0668a6eb31686b63fdd048f8870))
* **ui:** album-art collages on genre and mix cards ([7b38c79](https://github.com/matjam/musex/commit/7b38c79a75bc00e3ef69895b27b1b37447164fc9))
* **ui:** artist/album names link to their pages everywhere ([ae7a8fc](https://github.com/matjam/musex/commit/ae7a8fc96bb139d3ba9e8ee6b51357f64c024803))
* **ui:** click-to-select + right detail panel; double-click plays; track links ([4d74f66](https://github.com/matjam/musex/commit/4d74f6689759b7c1a4fa404c54952aedd9492500))
* **ui:** clickable 5-star ratings — now-playing bar, artist page, track rows, detail panel ([ffd5a99](https://github.com/matjam/musex/commit/ffd5a9968436fc345b78f918516069311d989fa6))
* **ui:** deterministic gradient + icon placeholder for missing artwork ([682713b](https://github.com/matjam/musex/commit/682713bd4910042957d126524d1131b1e385f89a))
* **ui:** External Artist discography view + Downloads status view (Lidarr-backed) ([64af189](https://github.com/matjam/musex/commit/64af1894a5f7cd927d56a731a7df33a6850a0775))
* **ui:** Go to artist/album in the track context menu; fix dead player-bar links ([6139cb4](https://github.com/matjam/musex/commit/6139cb4b45289331db9307c73b3f3cda8cae2210))
* **ui:** hierarchy breadcrumbs — album page shows Artist › Album; track panel shows Artist › Album › Track ([f3183c8](https://github.com/matjam/musex/commit/f3183c8b5529f5379fed6f3c093a703569f82a30))
* **ui:** Home view (default landing) — top playlists + random artists/albums ([154fbfc](https://github.com/matjam/musex/commit/154fbfca3e0822d238af147256e12e6e6caad9e3))
* **ui:** keyboard shortcuts move to a modal (⌘/ and Help menu); removed from Settings ([2c10e5a](https://github.com/matjam/musex/commit/2c10e5a89d6dacfd130d843113462e34ed3f7cfd))
* **ui:** lucide nav icons + SortSelector component ([84a4e13](https://github.com/matjam/musex/commit/84a4e132e8af994fb5e821983f3075aec5c3d6bb))
* **ui:** persistent top bar with drag region + search; sign-in screen draggable ([e17973f](https://github.com/matjam/musex/commit/e17973f4a9b138c58985e2cba6c863199ef5a94a))
* **ui:** Play + Shuffle on album & artist detail views ([882c1fe](https://github.com/matjam/musex/commit/882c1fea07047acbd28e4d7c4b69b92e5e118373))
* **ui:** Play + Shuffle on playlists and the full Tracks list ([9042d82](https://github.com/matjam/musex/commit/9042d822688d8a94452131bc6591ca21ad158bfd))
* **ui:** Spotify-style hover Play button on album/artist grid cards ([cc8486b](https://github.com/matjam/musex/commit/cc8486bf50bdc5ecd670fb217c6ebef9151f9178))
* **ui:** Spotify-style keyboard shortcuts + Settings reference ([05e232f](https://github.com/matjam/musex/commit/05e232f263b34d849e012e250993d90b63b8a8c8))
* **ui:** transport bar always visible; controls greyed when nothing is queued ([d2f4e34](https://github.com/matjam/musex/commit/d2f4e34196f539f28cce4411470cb3cbadf5293a))
* **updater:** auto-update from GitHub releases + Check for Updates menu item ([d260ec7](https://github.com/matjam/musex/commit/d260ec723812ea4fd445e9d5ff1c5dd733abdddd))
* **vendor:** pinned, checksum-verified mpv fetch script (darwin-arm64) ([01b0e25](https://github.com/matjam/musex/commit/01b0e25b310cd868db999d81ed31c9093b159e8c))


### Bug Fixes

* **audio:** swallow benign play() AbortError on rapid track changes ([3b7a953](https://github.com/matjam/musex/commit/3b7a953aeaf6be4f81be1ccad94c8bafbc57e452))
* **audio:** use progressive HTML5 playback (disable gapless Web Audio path) ([644a6d8](https://github.com/matjam/musex/commit/644a6d89b3e3c4c4a9219be7701101648356b271))
* **cache:** decouple cache write from playback (fixes ERR_STREAM_DESTROYED + stalled start) ([0db402f](https://github.com/matjam/musex/commit/0db402f7d834111cd314d87a8c218e973f0ae560))
* **cache:** harden write-through proxy after code review ([25a58c0](https://github.com/matjam/musex/commit/25a58c088e141e43e7554f44b9cd5dd702dc9205))
* **cache:** suppress benign ERR_STREAM_DESTROYED on aborted cache writes ([cd3886e](https://github.com/matjam/musex/commit/cd3886e55f829f45575a3b8e78d36b05614d0aef))
* **lastfm:** help text explains the login-walled API account page ([0275808](https://github.com/matjam/musex/commit/0275808a81af4bf9a6b00cf7ec41839b6a2734a9))
* **lidarr:** race-proof artist ensure + deferred album request when metadata is still refreshing ([8849a2a](https://github.com/matjam/musex/commit/8849a2a8bdd5845d5acca34b4f183a1ff072933b))
* **lidarr:** re-monitor the artist when requesting an album (Lidarr[#3597](https://github.com/matjam/musex/issues/3597) workaround) ([78cc2a4](https://github.com/matjam/musex/commit/78cc2a49af382ffaf49946790d0c9ad3f2ca6a22))
* patch gapless-5 null-deref in onLoadedHTML5Metadata on track change ([cdbf788](https://github.com/matjam/musex/commit/cdbf7881e71f01393a77909fe2038ee783d2c9f5))
* **perf:** guard progressive paging against empty-page loop + unmount setState ([caaf21e](https://github.com/matjam/musex/commit/caaf21eac83d9e35a6e45301917686842e7b9e59))
* **playback:** never play two streams at once; carry repeat into new collections ([276a727](https://github.com/matjam/musex/commit/276a7274e5d5e43e516145169ccb1c101c7c77f0))
* **playlists:** constrain track context menu to viewport ([b545e45](https://github.com/matjam/musex/commit/b545e4566bffd53da89f5f920adf628405933337))
* **playlists:** create only from a track (no empty create) + live header from store ([a96913f](https://github.com/matjam/musex/commit/a96913f67cd9ec4d161410a4c9a48d3136d1a817))
* **plex:** don't cache the 4s probe timeout on the server connection ([f196420](https://github.com/matjam/musex/commit/f196420f27594a95257f2c84eca4b8007aa63358))
* **plex:** one bad server must not fail sign-in; use per-server access tokens ([c27b873](https://github.com/matjam/musex/commit/c27b873f7fcb550554e18ccd58d2e4467d7125e7))
* **plugins:** prefer dist/ manifest over a package-root source manifest ([1440eb9](https://github.com/matjam/musex/commit/1440eb96595abf2ac34920eef7a9521942097840))
* **prefetch:** current track first, strictly sequential (concurrency 1) ([305f2bc](https://github.com/matjam/musex/commit/305f2bc8f915a75c597bf07d74eb3d4d372b9204))
* **release:** pin electron exactly for electron-builder; drop spent release-as; manual DMG rebuild dispatch ([bdc9177](https://github.com/matjam/musex/commit/bdc9177578f508ac89dc964271e3c56c9ad5560b))
* **search:** stacked result groups flow in scrolling search page ([701814f](https://github.com/matjam/musex/commit/701814fbe035a1718c7265bed4f8f98f203f1c03))
* **security:** redact proxy secret from [musex-debug] logs ([42a6e1c](https://github.com/matjam/musex/commit/42a6e1c8009e8e472529f4ee7fdb959a5b23a45a))
* **settings:** make toggle track visible — grey off-state fill + stronger border ([b427638](https://github.com/matjam/musex/commit/b427638e8830528c21029555423ed9a897af6749))
* **settings:** make toggle visible — .switch needs display:inline-block ([334087b](https://github.com/matjam/musex/commit/334087b4b69c0c9d01823c1d93d07ee91205642f))
* **settings:** rebuild cache toggle with real DOM elements (button/span) ([dfabe10](https://github.com/matjam/musex/commit/dfabe10c7b332dfc20c11130cfd2f6db9af8e290))
* **theme:** rogue '*/' in header comment silently killed all CSS variables ([b10402c](https://github.com/matjam/musex/commit/b10402c52a00aaf101c2c6cb2344c4a46c376248))
* **tracks:** artistId never reached the renderer — forward grandparentRatingKey ([d951143](https://github.com/matjam/musex/commit/d951143bdd6ee21ac986759402c6456072703dc0))
* **ui:** no text selection in app chrome; queue drawer clears the topbar drag region ([a3c3dcd](https://github.com/matjam/musex/commit/a3c3dcdaaee46b537f022cf00450da85c0b319d1))
* **ui:** Similar results open as a main view; header button alignment ([8a3a1cd](https://github.com/matjam/musex/commit/8a3a1cdbc5936ab21b881268121d43ebc4fb6109))
* **ui:** suppress tab-focus rings on app chrome; inputs keep a focus border ([b58d217](https://github.com/matjam/musex/commit/b58d217af5c359a10a546298e7d6eb3c2c99f098))


### Performance Improvements

* **startup:** cache server base URL, skip @ctrl/plex's 10s connection probe ([b538669](https://github.com/matjam/musex/commit/b53866960d467640a189ad4d5379addbc5150e45))

## [0.1.1](https://github.com/matjam/musex/compare/musex-v0.1.0...musex-v0.1.1) (2026-06-10)


### Bug Fixes

* **plex:** one bad server must not fail sign-in; use per-server access tokens ([c27b873](https://github.com/matjam/musex/commit/c27b873f7fcb550554e18ccd58d2e4467d7125e7))
* **release:** pin electron exactly for electron-builder; drop spent release-as; manual DMG rebuild dispatch ([bdc9177](https://github.com/matjam/musex/commit/bdc9177578f508ac89dc964271e3c56c9ad5560b))

## 0.1.0 (2026-06-10)


### Features

* album/artist art via musex-stream proxy (token-safe) with gradient fallback ([0c6aacb](https://github.com/matjam/musex/commit/0c6aacb7f38a16d87abd037e6e4b03d8e7783b7b))
* **albums:** library-wide Albums view with sort + cache; cache Artists list ([48bc9ab](https://github.com/matjam/musex/commit/48bc9abb504d83a6d4565dbea03063623c452b78))
* **art-cache:** isArtPath + sniffImageType helpers ([f112ea0](https://github.com/matjam/musex/commit/f112ea0bb3f1b445f221e85408b0570f88900ddb))
* **art-cache:** proxy serves/writes art through an always-on disk cache (+ immutable Cache-Control) ([b77d698](https://github.com/matjam/musex/commit/b77d698e87157aa8460d12065cd8b966e7e35e78))
* **art-cache:** Settings cache size + Clear cover audio and art ([fe9efe9](https://github.com/matjam/musex/commit/fe9efe97d917a1204aaf133f44437663f9c1343a))
* **art-cache:** wire always-on art MediaCache into Runtime + proxy ([e0df22c](https://github.com/matjam/musex/commit/e0df22cc4bc3d7b72ffe848fa5e2fcd72c925169))
* **audio:** play watchdog retries a stalled track load ([07fe4cf](https://github.com/matjam/musex/commit/07fe4cf50c25e7f15eb760dd7540a71184b8d450))
* auto-restore Plex session on startup (skip sign-in when token persists) ([4e0c25f](https://github.com/matjam/musex/commit/4e0c25fa934145e8695d7a687ad80c6e29d817e1))
* **cache:** CachingPlexGateway decorator + wire into Runtime ([38e9976](https://github.com/matjam/musex/commit/38e9976c6b5bc75555f281d2f59c2110a10d7b55))
* **cache:** filesystem MediaCache adapter (write-through, LRU evict, clear) ([ca6efe6](https://github.com/matjam/musex/commit/ca6efe6e0c11b1d06b595e1308b0ed5c02c2eb83))
* **cache:** ListCacheStore (disk-persisted, validator-keyed, evicting) ([feff037](https://github.com/matjam/musex/commit/feff037a4e1d11ad5875d9ef3df436c6d6e50b9d))
* **cache:** map Plex updatedAt onto models + listValidator helper ([e5390ed](https://github.com/matjam/musex/commit/e5390edeebf03f9f0bf60d171b4b930394308ae6))
* **cache:** pass list validators from renderer through IPC (instant re-opens) ([6a01967](https://github.com/matjam/musex/commit/6a019677e2baf8588fc38ecddc5007e94db35709))
* **cache:** persistence fields + preference IPC contract + preload ([93309f5](https://github.com/matjam/musex/commit/93309f5fc5ee7258d53c286fb252d939790b80db))
* **cache:** progressive paged loading for long playlist tracks ([d5ce34b](https://github.com/matjam/musex/commit/d5ce34b102bf309c3ecd7353b35c081ab88fa1b2))
* **cache:** pure cache logic (key, range, content-type, LRU selection) ([819ca0c](https://github.com/matjam/musex/commit/819ca0c433d05be6e190110e039981416a36b0b6))
* **cache:** stream-proxy write-through + serve-from-disk (range-aware) ([3b8a1fe](https://github.com/matjam/musex/commit/3b8a1fe997a105765452c7fece7b9634afb5a709))
* **cache:** wire MediaCache into runtime + preference/cache IPC handlers ([29d1bc6](https://github.com/matjam/musex/commit/29d1bc625ba470fe2df0107f945dba8ad47500c2))
* **core:** add updatedAt to Artist/Album/Playlist for cache validation ([b961301](https://github.com/matjam/musex/commit/b961301a00c0e9cdff5a7785db9fbc860de249d5))
* **core:** LibrarySort, Library.updatedAt, listAllAlbums/listAllTracksPage port + fake ([386455c](https://github.com/matjam/musex/commit/386455cdd31ff791d8ca26227f054d410043781a))
* **core:** PlaybackSession.restore() — resume a saved queue paused at position ([9200f68](https://github.com/matjam/musex/commit/9200f6875c84bd07a9797b0295c6843295ab674d))
* **core:** playlist models, PlexGateway playlist ops, createPlaylist use-case ([124b3fb](https://github.com/matjam/musex/commit/124b3fb127ebbe769940fedcc9a0bd5413baa5b0))
* **core:** queue ops + shuffle + repeat in PlaybackSession (TDD) ([ba3960f](https://github.com/matjam/musex/commit/ba3960f7218d5f976a0cae021a8a503ea3eb634e))
* **core:** RepeatMode + Queue shuffle/repeat fields ([0e5665a](https://github.com/matjam/musex/commit/0e5665af4db1d9cd28fac0c76131c5554eecb824))
* **core:** search model, PlexGateway.search port, searchLibrary use-case ([77bf796](https://github.com/matjam/musex/commit/77bf796079e01a7bf4b897fa7b4176765de0cb74))
* **core:** Track.artistId + PlaybackSession.playTrackNext (double-click play) ([313e8de](https://github.com/matjam/musex/commit/313e8deb1c901ee9f71f79442486f21c4ca75776))
* **desktop:** pure mpv JSON-IPC command builders + event mapper ([1184c2e](https://github.com/matjam/musex/commit/1184c2e1237136a9882d02e81fcd8f7ecbaa1b2c))
* **discover:** real last.fm artwork, proxied + cached through the art cache ([5ec6f0b](https://github.com/matjam/musex/commit/5ec6f0bfc9da3873b66fc131dc05ccb66e58e7f9))
* **genres:** genre index + per-genre dynamic playlists (cache v5) ([38fa4c9](https://github.com/matjam/musex/commit/38fa4c9b1893e50b9cb7e576b307c8f0d8c936c3))
* **ipc:** library-wide albums (cached) + paged tracks channels ([fa796dd](https://github.com/matjam/musex/commit/fa796dd4442a38feb33a3ca1d76007926a65b3a5))
* **ipc:** playlist channels (contract + preload + handlers with art baking) ([28cf88a](https://github.com/matjam/musex/commit/28cf88a77d32300da9fe8d9959ff50e8d5c82964))
* **ipc:** save/load playback state; normalize+re-bake art thumbs at the boundary ([1dbc475](https://github.com/matjam/musex/commit/1dbc4757469b04afcfb9d322b7d97a936e44462a))
* **ipc:** search channel (contract + preload + handler with art baking) ([1fb6695](https://github.com/matjam/musex/commit/1fb66957ca2601c1a81bb598454d2d29abdb8868))
* **lastfm:** last.fm plugin — auth, scrobbling, Love action (first dynamic plugin) ([0bafd11](https://github.com/matjam/musex/commit/0bafd1145ce346ec1672acf355dbea5d1f1488b7))
* **lidarr:** Allow self-signed certificates toggle (node:https transport) ([25c3791](https://github.com/matjam/musex/commit/25c3791845ba7ba2695a438f36bff10bfb8834fd))
* **lidarr:** Lidarr plugin — discography lookup, album acquisition, download status ([26bc2f1](https://github.com/matjam/musex/commit/26bc2f10b1826d6bd3fbe29e582005519a29e3a2))
* **main:** MpvController — vendored mpv over JSON IPC + playback IPC surface ([48c61f3](https://github.com/matjam/musex/commit/48c61f3ceca1c1ade89590ab9c677e2c727e913c))
* **main:** persist playback queue + cursor in separate stores; add parseProxyPath ([0fcb93a](https://github.com/matjam/musex/commit/0fcb93aff01dbc08f03e4cc799a45610939ec5f5))
* **menu:** application menu with Help — shortcuts, GitHub, issues, logs folder ([9bd7586](https://github.com/matjam/musex/commit/9bd758689395a98dbe1c8615d5133fea2f52ffd3))
* **mixes:** mood mixes — Driving/Workout/Chill/Coding from genre+mood tags, taste-ordered (cache v6) ([8f30105](https://github.com/matjam/musex/commit/8f30105f36723e43bbf66fcb713a5a3d96507de3))
* **perf:** virtualized track lists (@tanstack/react-virtual) ([e136651](https://github.com/matjam/musex/commit/e136651ce81e8236a34e2727bf09520a6f52bfba))
* **playlists:** playlist store, TrackRow menu trigger, TrackContextMenu ([a163e36](https://github.com/matjam/musex/commit/a163e36a2c73e4df121573f7ac71baa832397c5c))
* **playlists:** PlaylistView + add-to-playlist menu across album/search/playlist ([3589f6d](https://github.com/matjam/musex/commit/3589f6d91141df73ba3a55dd71a2daf4bf35f7b0))
* **playlists:** sidebar rail + New Playlist dialog (create flow) ([ddae800](https://github.com/matjam/musex/commit/ddae80004c20003b09331a9e50eb6f2dbd5e49c1))
* **playlists:** smart playlists — Top Rated, Heavy Rotation, Rediscover ([f934bca](https://github.com/matjam/musex/commit/f934bcaced59a66b1f91d50cea0bf45502857592))
* **plex:** implement library search (artists/albums/tracks) ([f267d48](https://github.com/matjam/musex/commit/f267d48263b6c67ce4f152eaebe81fa86227ffcd))
* **plex:** implement playlist CRUD (+ env-gated round-trip smoke test) ([6dba6f7](https://github.com/matjam/musex/commit/6dba6f76f9c9a373098ce0fdab3487c0c956c861))
* **plex:** library-wide listAllAlbums + paged listAllTracks + section updatedAt ([2adb473](https://github.com/matjam/musex/commit/2adb4737983bd309e2c1968770662d08f0ec273d))
* **plugins:** AcquisitionProvider extension point — lookup, acquire, status ([3d92c0a](https://github.com/matjam/musex/commit/3d92c0a1481d664ae96932509239034dad20200a))
* **plugins:** dynamic plugin host — manifest, loader, ctx kernel, settings UI ([6deeb26](https://github.com/matjam/musex/commit/6deeb2669c3f314d75461aace3db00a468e9c3fd))
* **plugins:** playback events pipeline — monitor, scrobble gate, ctx.events + ctx.library ([e9c5016](https://github.com/matjam/musex/commit/e9c5016b967bfc20f3e9d43c4ad30c6d24e1fe70))
* **plugins:** sections + Discover view + track actions/detail points; last.fm providers ([b5c8b03](https://github.com/matjam/musex/commit/b5c8b030d8cbb0c5e4b584a0253f0f6c01743dcb))
* **prefetch:** StreamProxy.prefetch warms upcoming tracks into the cache ([3ebe66f](https://github.com/matjam/musex/commit/3ebe66f229da779617fb05b440d6f1b3b3018793))
* **prefetch:** trigger upcoming-track prefetch from the player on queue change ([513178d](https://github.com/matjam/musex/commit/513178da2744ee3909f4e38e6c9e7fe3551384dc))
* **queue:** lucide transport icons + shuffle/repeat/queue controls ([9f8e2ea](https://github.com/matjam/musex/commit/9f8e2eaf8aa853bcd5dcd352805c4ae0d596c191))
* **queue:** Play next / Add to queue for tracks, albums, artists ([4f2da4f](https://github.com/matjam/musex/commit/4f2da4f29a4e60c863f98ad20f0fb920ec97bf8b))
* **queue:** right-side QueueDrawer with drag reorder + remove + clear ([a71c97c](https://github.com/matjam/musex/commit/a71c97c6e4d9975530de7d48923d7413cd690fac))
* **radio:** radio mode — seeded auto-extending queue, start from track/artist, queue-drawer control ([83f50e2](https://github.com/matjam/musex/commit/83f50e2c3e2042b37453d865a1a079ace9c15e9c))
* **radio:** TrackRecommender extension point, host-side resolution, last.fm recommender ([a704f47](https://github.com/matjam/musex/commit/a704f47ab83a7a3ef08cfc00231c0b6acb4cc58b))
* **ratings:** album ratings — Plex write, cache v4, stars on the album page ([2cd0a30](https://github.com/matjam/musex/commit/2cd0a30766635d82f683288bf3016c730e3c10fa))
* **ratings:** Plex userRating on tracks/artists — model, gateway rate/read, cache v3 + eviction, IPC ([3004d93](https://github.com/matjam/musex/commit/3004d93e20da2498aec2a3a08049b602f46519ed))
* **ratings:** trackRated plugin event; last.fm loves 4★+ tracks ([a4336c6](https://github.com/matjam/musex/commit/a4336c6281a2df1cc327b16d0796524f75b6a780))
* **release:** electron-builder DMG packaging + signed/notarized release CI with release-please (0.x) ([725b140](https://github.com/matjam/musex/commit/725b1403bd5feefb878ed64228acca6a80998574))
* **renderer:** IpcPlaybackEngine — playback now runs on vendored mpv ([4903b87](https://github.com/matjam/musex/commit/4903b87c98715ba9e07d54337c39594b1b8d6b6b))
* **renderer:** restore playback on launch; persist queue + cursor on change ([bab7cfe](https://github.com/matjam/musex/commit/bab7cfe0f3c4ba994163e6fe810ae004577d34bc))
* **search:** federated external search + monitor-entire-artist via Lidarr ([f02b67f](https://github.com/matjam/musex/commit/f02b67f34b87c998846112af141eb361b90b850f))
* **search:** live SearchView (grouped results) + working Search nav ([cab1433](https://github.com/matjam/musex/commit/cab14336cf7133b272740275ec1ef2eff62c2444))
* **settings:** sectioned Settings view with local-cache controls ([b83c9f4](https://github.com/matjam/musex/commit/b83c9f4a3e6ca33d5e8bed45e034bba867e8a5ca))
* **similar:** Similar panel for artists + songs — plugin point, last.fm provider, side panel UI ([d0917fa](https://github.com/matjam/musex/commit/d0917fa027fcd7a0d6ed4436cfcf0f71c651263e))
* **smart:** For You mix — taste + similar-owned resurfacing; listening stats in the track panel ([7b05ebd](https://github.com/matjam/musex/commit/7b05ebd13dc785c26d7f1797e77f3af86cb64c7c))
* **taste:** persisted listening profile — affinity scoring, decay, topArtists for plugins ([e650b54](https://github.com/matjam/musex/commit/e650b544b847803bea00952876aed27290fed9ae))
* **tracks:** cached full listAllTracks (mirrors listAllAlbums) ([8dbe134](https://github.com/matjam/musex/commit/8dbe1344cf2d6e7c8f93393c4e85798802bd92f2))
* **tracks:** library-wide Tracks view (virtualized, sortable, cached) ([a6cc636](https://github.com/matjam/musex/commit/a6cc63674057d0668a6eb31686b63fdd048f8870))
* **ui:** album-art collages on genre and mix cards ([7b38c79](https://github.com/matjam/musex/commit/7b38c79a75bc00e3ef69895b27b1b37447164fc9))
* **ui:** artist/album names link to their pages everywhere ([ae7a8fc](https://github.com/matjam/musex/commit/ae7a8fc96bb139d3ba9e8ee6b51357f64c024803))
* **ui:** click-to-select + right detail panel; double-click plays; track links ([4d74f66](https://github.com/matjam/musex/commit/4d74f6689759b7c1a4fa404c54952aedd9492500))
* **ui:** clickable 5-star ratings — now-playing bar, artist page, track rows, detail panel ([ffd5a99](https://github.com/matjam/musex/commit/ffd5a9968436fc345b78f918516069311d989fa6))
* **ui:** deterministic gradient + icon placeholder for missing artwork ([682713b](https://github.com/matjam/musex/commit/682713bd4910042957d126524d1131b1e385f89a))
* **ui:** External Artist discography view + Downloads status view (Lidarr-backed) ([64af189](https://github.com/matjam/musex/commit/64af1894a5f7cd927d56a731a7df33a6850a0775))
* **ui:** Go to artist/album in the track context menu; fix dead player-bar links ([6139cb4](https://github.com/matjam/musex/commit/6139cb4b45289331db9307c73b3f3cda8cae2210))
* **ui:** hierarchy breadcrumbs — album page shows Artist › Album; track panel shows Artist › Album › Track ([f3183c8](https://github.com/matjam/musex/commit/f3183c8b5529f5379fed6f3c093a703569f82a30))
* **ui:** Home view (default landing) — top playlists + random artists/albums ([154fbfc](https://github.com/matjam/musex/commit/154fbfca3e0822d238af147256e12e6e6caad9e3))
* **ui:** keyboard shortcuts move to a modal (⌘/ and Help menu); removed from Settings ([2c10e5a](https://github.com/matjam/musex/commit/2c10e5a89d6dacfd130d843113462e34ed3f7cfd))
* **ui:** lucide nav icons + SortSelector component ([84a4e13](https://github.com/matjam/musex/commit/84a4e132e8af994fb5e821983f3075aec5c3d6bb))
* **ui:** persistent top bar with drag region + search; sign-in screen draggable ([e17973f](https://github.com/matjam/musex/commit/e17973f4a9b138c58985e2cba6c863199ef5a94a))
* **ui:** Play + Shuffle on album & artist detail views ([882c1fe](https://github.com/matjam/musex/commit/882c1fea07047acbd28e4d7c4b69b92e5e118373))
* **ui:** Play + Shuffle on playlists and the full Tracks list ([9042d82](https://github.com/matjam/musex/commit/9042d822688d8a94452131bc6591ca21ad158bfd))
* **ui:** Spotify-style hover Play button on album/artist grid cards ([cc8486b](https://github.com/matjam/musex/commit/cc8486bf50bdc5ecd670fb217c6ebef9151f9178))
* **ui:** Spotify-style keyboard shortcuts + Settings reference ([05e232f](https://github.com/matjam/musex/commit/05e232f263b34d849e012e250993d90b63b8a8c8))
* **ui:** transport bar always visible; controls greyed when nothing is queued ([d2f4e34](https://github.com/matjam/musex/commit/d2f4e34196f539f28cce4411470cb3cbadf5293a))
* **vendor:** pinned, checksum-verified mpv fetch script (darwin-arm64) ([01b0e25](https://github.com/matjam/musex/commit/01b0e25b310cd868db999d81ed31c9093b159e8c))


### Bug Fixes

* **audio:** swallow benign play() AbortError on rapid track changes ([3b7a953](https://github.com/matjam/musex/commit/3b7a953aeaf6be4f81be1ccad94c8bafbc57e452))
* **audio:** use progressive HTML5 playback (disable gapless Web Audio path) ([644a6d8](https://github.com/matjam/musex/commit/644a6d89b3e3c4c4a9219be7701101648356b271))
* **cache:** decouple cache write from playback (fixes ERR_STREAM_DESTROYED + stalled start) ([0db402f](https://github.com/matjam/musex/commit/0db402f7d834111cd314d87a8c218e973f0ae560))
* **cache:** harden write-through proxy after code review ([25a58c0](https://github.com/matjam/musex/commit/25a58c088e141e43e7554f44b9cd5dd702dc9205))
* **cache:** suppress benign ERR_STREAM_DESTROYED on aborted cache writes ([cd3886e](https://github.com/matjam/musex/commit/cd3886e55f829f45575a3b8e78d36b05614d0aef))
* **lastfm:** help text explains the login-walled API account page ([0275808](https://github.com/matjam/musex/commit/0275808a81af4bf9a6b00cf7ec41839b6a2734a9))
* **lidarr:** race-proof artist ensure + deferred album request when metadata is still refreshing ([8849a2a](https://github.com/matjam/musex/commit/8849a2a8bdd5845d5acca34b4f183a1ff072933b))
* **lidarr:** re-monitor the artist when requesting an album (Lidarr[#3597](https://github.com/matjam/musex/issues/3597) workaround) ([78cc2a4](https://github.com/matjam/musex/commit/78cc2a49af382ffaf49946790d0c9ad3f2ca6a22))
* patch gapless-5 null-deref in onLoadedHTML5Metadata on track change ([cdbf788](https://github.com/matjam/musex/commit/cdbf7881e71f01393a77909fe2038ee783d2c9f5))
* **perf:** guard progressive paging against empty-page loop + unmount setState ([caaf21e](https://github.com/matjam/musex/commit/caaf21eac83d9e35a6e45301917686842e7b9e59))
* **playback:** never play two streams at once; carry repeat into new collections ([276a727](https://github.com/matjam/musex/commit/276a7274e5d5e43e516145169ccb1c101c7c77f0))
* **playlists:** constrain track context menu to viewport ([b545e45](https://github.com/matjam/musex/commit/b545e4566bffd53da89f5f920adf628405933337))
* **playlists:** create only from a track (no empty create) + live header from store ([a96913f](https://github.com/matjam/musex/commit/a96913f67cd9ec4d161410a4c9a48d3136d1a817))
* **plex:** don't cache the 4s probe timeout on the server connection ([f196420](https://github.com/matjam/musex/commit/f196420f27594a95257f2c84eca4b8007aa63358))
* **plugins:** prefer dist/ manifest over a package-root source manifest ([1440eb9](https://github.com/matjam/musex/commit/1440eb96595abf2ac34920eef7a9521942097840))
* **prefetch:** current track first, strictly sequential (concurrency 1) ([305f2bc](https://github.com/matjam/musex/commit/305f2bc8f915a75c597bf07d74eb3d4d372b9204))
* **search:** stacked result groups flow in scrolling search page ([701814f](https://github.com/matjam/musex/commit/701814fbe035a1718c7265bed4f8f98f203f1c03))
* **security:** redact proxy secret from [musex-debug] logs ([42a6e1c](https://github.com/matjam/musex/commit/42a6e1c8009e8e472529f4ee7fdb959a5b23a45a))
* **settings:** make toggle track visible — grey off-state fill + stronger border ([b427638](https://github.com/matjam/musex/commit/b427638e8830528c21029555423ed9a897af6749))
* **settings:** make toggle visible — .switch needs display:inline-block ([334087b](https://github.com/matjam/musex/commit/334087b4b69c0c9d01823c1d93d07ee91205642f))
* **settings:** rebuild cache toggle with real DOM elements (button/span) ([dfabe10](https://github.com/matjam/musex/commit/dfabe10c7b332dfc20c11130cfd2f6db9af8e290))
* **theme:** rogue '*/' in header comment silently killed all CSS variables ([b10402c](https://github.com/matjam/musex/commit/b10402c52a00aaf101c2c6cb2344c4a46c376248))
* **tracks:** artistId never reached the renderer — forward grandparentRatingKey ([d951143](https://github.com/matjam/musex/commit/d951143bdd6ee21ac986759402c6456072703dc0))
* **ui:** no text selection in app chrome; queue drawer clears the topbar drag region ([a3c3dcd](https://github.com/matjam/musex/commit/a3c3dcdaaee46b537f022cf00450da85c0b319d1))
* **ui:** Similar results open as a main view; header button alignment ([8a3a1cd](https://github.com/matjam/musex/commit/8a3a1cdbc5936ab21b881268121d43ebc4fb6109))
* **ui:** suppress tab-focus rings on app chrome; inputs keep a focus border ([b58d217](https://github.com/matjam/musex/commit/b58d217af5c359a10a546298e7d6eb3c2c99f098))


### Performance Improvements

* **startup:** cache server base URL, skip @ctrl/plex's 10s connection probe ([b538669](https://github.com/matjam/musex/commit/b53866960d467640a189ad4d5379addbc5150e45))
