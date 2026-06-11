# Audio Filters (Volume Leveling + EQ Presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Audio section in Settings with a volume-leveling mode (Off / ReplayGain / Auto) and an EQ preset select (Bass Boost etc.) that apply instantly to mpv playback and persist across restarts.

**Architecture:** All filter knowledge lives in a new pure module `logic/audio-filters.ts` that maps prefs → mpv `af` / `replaygain` property values. `MpvController` gains `applyAudioConfig()` which caches the config and re-applies it on every (re)spawn. New IPC channels (`musex:audio:getPrefs/setPrefs`) persist via electron-store and push to mpv; the renderer's SettingsView renders two selects.

**Tech Stack:** TypeScript, Electron (main-process mpv over JSON IPC), React renderer, vitest, electron-store. Spec: `docs/superpowers/specs/2026-06-11-audio-filters-design.md`.

**Conventions that apply to every task:** run commands from the repo root (`/Users/matjam/src/musex`); commit with `git add -A` (never selective) and push after every commit; before each commit run `pnpm check` (the CI bar: lint + typecheck + format + tests) and fix anything it flags (`pnpm exec biome check --write .` fixes most lint/format issues). All imports inside `packages/desktop` use `.js` extensions in main/logic files (ESM), and **no** extension in renderer files (vite) — copy the style of the file you're editing.

---

### Task 1: Pure logic — preset table and property mapping

**Files:**
- Create: `packages/desktop/src/logic/audio-filters.ts`
- Test: `packages/desktop/src/logic/audio-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/logic/audio-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildAf,
  DEFAULT_AUDIO_PREFS,
  EQ_PRESETS,
  replaygainMode,
  sanitizeAudioPrefs,
} from "./audio-filters";

describe("buildAf", () => {
  it("everything off → empty string", () => {
    expect(buildAf({ leveling: "off", eqPreset: "off" })).toBe("");
  });

  it("replaygain leveling adds no filter (it is a separate property)", () => {
    expect(buildAf({ leveling: "replaygain", eqPreset: "off" })).toBe("");
  });

  it("eq only", () => {
    expect(buildAf({ leveling: "off", eqPreset: "bass-boost" })).toBe("lavfi=[bass=g=6:f=110]");
  });

  it("auto leveling only", () => {
    expect(buildAf({ leveling: "auto", eqPreset: "off" })).toBe("lavfi=[dynaudnorm]");
  });

  it("eq + auto leveling: dynaudnorm comes after the EQ", () => {
    expect(buildAf({ leveling: "auto", eqPreset: "loudness" })).toBe(
      "lavfi=[bass=g=5:f=100,treble=g=3:f=8000,dynaudnorm]",
    );
  });

  it("every non-off preset produces a lavfi graph", () => {
    for (const p of EQ_PRESETS.filter((p) => p.id !== "off")) {
      expect(buildAf({ leveling: "off", eqPreset: p.id })).toBe(`lavfi=[${p.graph}]`);
    }
  });
});

describe("replaygainMode", () => {
  it("maps replaygain → album, everything else → no", () => {
    expect(replaygainMode({ leveling: "replaygain", eqPreset: "off" })).toBe("album");
    expect(replaygainMode({ leveling: "off", eqPreset: "off" })).toBe("no");
    expect(replaygainMode({ leveling: "auto", eqPreset: "off" })).toBe("no");
  });
});

describe("sanitizeAudioPrefs", () => {
  it("passes valid prefs through", () => {
    expect(sanitizeAudioPrefs({ leveling: "auto", eqPreset: "vocal" })).toEqual({
      leveling: "auto",
      eqPreset: "vocal",
    });
  });

  it("garbage in → defaults out", () => {
    expect(sanitizeAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs(undefined)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs("x")).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs({ leveling: "extreme", eqPreset: "metal" })).toEqual(
      DEFAULT_AUDIO_PREFS,
    );
  });

  it("mixed: keeps the valid field, defaults the invalid one", () => {
    expect(sanitizeAudioPrefs({ leveling: "auto", eqPreset: 7 })).toEqual({
      leveling: "auto",
      eqPreset: "off",
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/audio-filters.test.ts`
Expected: FAIL — cannot resolve `./audio-filters`.

- [ ] **Step 3: Implement the module**

Create `packages/desktop/src/logic/audio-filters.ts`:

```ts
/** Pure audio-filter knowledge: leveling modes, the EQ preset table, and the
 *  mpv `af` / `replaygain` property values they translate to. The controller
 *  and IPC layers only transport strings built here — free-form filter text
 *  never reaches mpv (a bad string can wedge its runtime filter reinit). */

export type LevelingMode = "off" | "replaygain" | "auto";

export interface AudioPrefs {
  leveling: LevelingMode;
  /** EQ preset id from EQ_PRESETS ("off" = no EQ). */
  eqPreset: string;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { leveling: "off", eqPreset: "off" };

export interface EqPreset {
  id: string;
  label: string;
  /** ffmpeg filtergraph fragment ("" = no EQ). Gains stay ≤6 dB to limit clipping. */
  graph: string;
}

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: "off", label: "Off", graph: "" },
  { id: "bass-boost", label: "Bass Boost", graph: "bass=g=6:f=110" },
  { id: "bass-reducer", label: "Bass Reducer", graph: "bass=g=-6:f=110" },
  { id: "treble-boost", label: "Treble Boost", graph: "treble=g=4:f=4000" },
  { id: "vocal", label: "Vocal Boost", graph: "equalizer=f=3000:t=q:w=1:g=4" },
  { id: "loudness", label: "Loudness", graph: "bass=g=5:f=100,treble=g=3:f=8000" },
];

/** mpv `af` property value ("" = no filters). Auto leveling (dynaudnorm) goes
 *  AFTER the EQ in the graph so it also absorbs any gain the EQ added. */
export function buildAf(prefs: AudioPrefs): string {
  const parts: string[] = [];
  const preset = EQ_PRESETS.find((p) => p.id === prefs.eqPreset);
  if (preset?.graph) parts.push(preset.graph);
  if (prefs.leveling === "auto") parts.push("dynaudnorm");
  return parts.length ? `lavfi=[${parts.join(",")}]` : "";
}

/** mpv `replaygain` property value. Album gain (not track) so albums keep
 *  their internal dynamics. */
export function replaygainMode(prefs: AudioPrefs): "album" | "no" {
  return prefs.leveling === "replaygain" ? "album" : "no";
}

const LEVELING_MODES: readonly LevelingMode[] = ["off", "replaygain", "auto"];

/** Normalize untrusted input (IPC payloads, hand-edited store JSON): unknown
 *  modes/preset ids fall back to defaults rather than throwing. */
export function sanitizeAudioPrefs(raw: unknown): AudioPrefs {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<
    Record<keyof AudioPrefs, unknown>
  >;
  const leveling = LEVELING_MODES.includes(obj.leveling as LevelingMode)
    ? (obj.leveling as LevelingMode)
    : DEFAULT_AUDIO_PREFS.leveling;
  const eqPreset = EQ_PRESETS.some((p) => p.id === obj.eqPreset)
    ? (obj.eqPreset as string)
    : DEFAULT_AUDIO_PREFS.eqPreset;
  return { leveling, eqPreset };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/audio-filters.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
pnpm check && git add -A && git commit -m "feat: audio-filter logic (EQ presets, af/replaygain mapping)" && git push
```

---

### Task 2: mpv command builders

**Files:**
- Modify: `packages/desktop/src/logic/mpv-ipc.ts` (add two builders after `cmdSetVolume`, ~line 40)
- Test: `packages/desktop/src/logic/mpv-ipc.test.ts` (extend the `command builders` describe block)

- [ ] **Step 1: Write the failing tests**

In `packages/desktop/src/logic/mpv-ipc.test.ts`, add `cmdSetAf` and `cmdSetReplaygain` to the existing import from `./mpv-ipc`, then add inside the `describe("command builders", ...)` block:

```ts
  it("cmdSetAf", () => {
    expect(cmdSetAf(10, "lavfi=[bass=g=6:f=110]")).toEqual({
      command: ["set_property", "af", "lavfi=[bass=g=6:f=110]"],
      request_id: 10,
    });
    expect(cmdSetAf(11, "")).toEqual({
      command: ["set_property", "af", ""],
      request_id: 11,
    });
  });

  it("cmdSetReplaygain", () => {
    expect(cmdSetReplaygain(12, "album")).toEqual({
      command: ["set_property", "replaygain", "album"],
      request_id: 12,
    });
    expect(cmdSetReplaygain(13, "no")).toEqual({
      command: ["set_property", "replaygain", "no"],
      request_id: 13,
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/mpv-ipc.test.ts`
Expected: FAIL — `cmdSetAf` is not exported.

- [ ] **Step 3: Implement the builders**

In `packages/desktop/src/logic/mpv-ipc.ts`, after `cmdSetVolume`:

```ts
/** Set the audio filter chain ("" clears it). Values come exclusively from
 *  logic/audio-filters.ts — never free-form user text. */
export function cmdSetAf(id: number, af: string): MpvCommand {
  return { command: ["set_property", "af", af], request_id: id };
}

export function cmdSetReplaygain(id: number, mode: "no" | "track" | "album"): MpvCommand {
  return { command: ["set_property", "replaygain", mode], request_id: id };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/mpv-ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && git add -A && git commit -m "feat: mpv af/replaygain command builders" && git push
```

---

### Task 3: MpvController.applyAudioConfig

**Files:**
- Modify: `packages/desktop/src/main/adapters/mpv-controller.ts`
- Test: `packages/desktop/src/main/adapters/mpv-controller.smoke.test.ts` (env-gated `MUSEX_MPV_E2E=1` — run it; the vendored binary is present on this machine)

- [ ] **Step 1: Extend the smoke test (the failing test)**

In `packages/desktop/src/main/adapters/mpv-controller.smoke.test.ts`, add to the imports:

```ts
import { buildAf, EQ_PRESETS, replaygainMode } from "../../logic/audio-filters.js";
```

and add this test inside the existing `run("MpvController (real vendored mpv, env-gated)", ...)` block:

```ts
  it("accepts every EQ preset × leveling combo (pins known-good af strings)", async () => {
    const controller = new MpvController({
      binaryPath: BINARY,
      socketPath: join(os.tmpdir(), "musex-mpv-af-test.sock"),
    });
    try {
      await controller.start();
      for (const preset of EQ_PRESETS) {
        for (const leveling of ["off", "replaygain", "auto"] as const) {
          const prefs = { leveling, eqPreset: preset.id };
          // applyAudioConfig rejects if mpv refuses either property set.
          await controller.applyAudioConfig({
            af: buildAf(prefs),
            replaygain: replaygainMode(prefs),
          });
        }
      }
    } finally {
      await controller.dispose();
    }
  }, 30_000);
```

- [ ] **Step 2: Verify it fails to compile/run**

Run: `MUSEX_MPV_E2E=1 pnpm --filter @musex/desktop exec vitest run src/main/adapters/mpv-controller.smoke.test.ts`
Expected: FAIL — `applyAudioConfig` does not exist on `MpvController`.

- [ ] **Step 3: Implement applyAudioConfig**

In `packages/desktop/src/main/adapters/mpv-controller.ts`:

(a) Add `cmdSetAf` and `cmdSetReplaygain` to the existing import from `../../logic/mpv-ipc.js`.

(b) Add the exported interface above the class:

```ts
export interface AudioConfig {
  /** mpv `af` property value ("" = no filters). */
  af: string;
  replaygain: "no" | "track" | "album";
}
```

(c) Add a field next to `private mapper = new MpvEventMapper();`:

```ts
  /** Desired audio filters/replaygain — cached so every (re)spawn applies it. */
  private audioConfig: AudioConfig = { af: "", replaygain: "no" };
```

(d) Add methods after `setVolume`:

```ts
  /** Cache the desired audio config and apply it now if mpv is running. The
   *  cached config is re-applied on every (re)spawn (see doStart), so a lazy
   *  start or post-crash respawn comes up with the right filters. Rejects if
   *  mpv refuses a property set (the caller surfaces that — no silent drop). */
  async applyAudioConfig(cfg: AudioConfig): Promise<void> {
    this.audioConfig = cfg;
    if (!this.running) return;
    await this.sendAudioConfig();
  }

  private async sendAudioConfig(): Promise<void> {
    await this.send((id) => cmdSetReplaygain(id, this.audioConfig.replaygain));
    await this.send((id) => cmdSetAf(id, this.audioConfig.af));
  }
```

(e) At the end of `doStart()`, after the two `cmdObserve` sends, add:

```ts
    await this.sendAudioConfig();
```

- [ ] **Step 4: Run the smoke test for real**

Run: `MUSEX_MPV_E2E=1 pnpm --filter @musex/desktop exec vitest run src/main/adapters/mpv-controller.smoke.test.ts`
Expected: PASS (both tests — playback unaffected, all 18 combos accepted).

- [ ] **Step 5: Commit**

```bash
pnpm check && git add -A && git commit -m "feat: MpvController.applyAudioConfig with respawn re-apply" && git push
```

---

### Task 4: Persistence + IPC + startup seed

**Files:**
- Modify: `packages/desktop/src/main/adapters/persistence.ts`
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/runtime.ts`

No new unit test in this task — it is store/IPC plumbing over the already-tested
pure functions, in a codebase that (deliberately) does not unit-test electron-store
or ipcMain wiring. `pnpm check` (typecheck) is the gate; behavior is verified
end-to-end in Task 5 Step 4.

- [ ] **Step 1: Persistence**

In `packages/desktop/src/main/adapters/persistence.ts`:

(a) Add to the imports:

```ts
import {
  type AudioPrefs,
  DEFAULT_AUDIO_PREFS,
  sanitizeAudioPrefs,
} from "../../logic/audio-filters.js";
```

(b) Add to the `PersistedState` interface (after `cacheMaxBytes: number;`):

```ts
  // Volume leveling + EQ preset (see logic/audio-filters.ts).
  audioPrefs: AudioPrefs;
```

(c) Add to the `store` defaults (after `cacheMaxBytes: DEFAULT_CACHE_MAX_BYTES,`):

```ts
    audioPrefs: DEFAULT_AUDIO_PREFS,
```

(d) Add to the `persistence` object (after `setCacheMaxBytes`):

```ts
  getAudioPrefs(): AudioPrefs {
    // sanitize on read: defends against hand-edited or stale store JSON.
    return sanitizeAudioPrefs(store.get("audioPrefs"));
  },
  setAudioPrefs(p: AudioPrefs): void {
    store.set("audioPrefs", p);
  },
```

- [ ] **Step 2: IPC contract**

In `packages/desktop/src/shared/ipc-contract.ts`:

(a) Add channels to the `IPC` const (after the `setVolume` line):

```ts
  getAudioPrefs: "musex:audio:getPrefs", // -> AudioPrefsDto
  setAudioPrefs: "musex:audio:setPrefs", // (AudioPrefsDto) -> void (applies to mpv, then persists)
```

(b) Add the DTO next to `export type Preferences = ...`:

```ts
/** Volume leveling + EQ preset. Structurally identical to
 *  `logic/audio-filters.ts`'s AudioPrefs — duplicated (like
 *  PlaybackEngineEvent) so preload never imports main-process logic. */
export type AudioPrefsDto = { leveling: "off" | "replaygain" | "auto"; eqPreset: string };
```

(c) Add to the `MusexApi` interface (after `setVolume(v: number): Promise<void>;`):

```ts
  getAudioPrefs(): Promise<AudioPrefsDto>;
  setAudioPrefs(prefs: AudioPrefsDto): Promise<void>;
```

- [ ] **Step 3: Main handler**

In `packages/desktop/src/main/ipc.ts`:

(a) Add to the imports:

```ts
import { buildAf, replaygainMode, sanitizeAudioPrefs } from "../logic/audio-filters.js";
```

(b) Add handlers right after the `IPC.setVolume` handler (~line 228):

```ts
  ipcMain.handle(IPC.getAudioPrefs, () => persistence.getAudioPrefs());
  ipcMain.handle(IPC.setAudioPrefs, async (_e, raw: unknown) => {
    const prefs = sanitizeAudioPrefs(raw);
    // Apply to mpv FIRST; persist only after it accepted (an mpv rejection
    // propagates to the renderer and the old prefs stay in force).
    await rt.mpv.applyAudioConfig({ af: buildAf(prefs), replaygain: replaygainMode(prefs) });
    persistence.setAudioPrefs(prefs);
  });
```

- [ ] **Step 4: Preload**

In `packages/desktop/src/preload/index.ts`, add to the `api` object (after the `setVolume` line):

```ts
  getAudioPrefs: () => ipcRenderer.invoke(IPC.getAudioPrefs),
  setAudioPrefs: (prefs) => ipcRenderer.invoke(IPC.setAudioPrefs, prefs),
```

- [ ] **Step 5: Startup seed**

In `packages/desktop/src/main/runtime.ts`:

(a) Add to the imports:

```ts
import { buildAf, replaygainMode } from "../logic/audio-filters.js";
```

(b) In `init()`, immediately after `this.mpv = new MpvController(resolveMpvPaths());`:

```ts
    // Seed the controller's cached audio config from persisted prefs — mpv
    // isn't running yet, so this only sets what the next spawn will apply.
    const audioPrefs = persistence.getAudioPrefs();
    await this.mpv.applyAudioConfig({
      af: buildAf(audioPrefs),
      replaygain: replaygainMode(audioPrefs),
    });
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm check`
Expected: clean (typecheck proves the contract/preload/handler agree).

```bash
git add -A && git commit -m "feat: audio prefs persistence, IPC channels, mpv startup seed" && git push
```

---

### Task 5: Settings UI — Audio section

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`

- [ ] **Step 1: Add the AudioSection component**

In `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`:

(a) Add to the imports (renderer files: no `.js` extension; logic imports follow the existing pattern, e.g. `MixView.tsx` imports `../../../../logic/mood-mixes`):

```ts
import type { AudioPrefsDto } from "../../../../shared/ipc-contract";
import {
  DEFAULT_AUDIO_PREFS,
  EQ_PRESETS,
  type LevelingMode,
} from "../../../../logic/audio-filters";
```

(`AudioPrefsDto` joins the existing `import type` block from `../../../../shared/ipc-contract`.)

(b) Add the component after `SettingsView` (next to `ExpansionSection`):

```tsx
const LEVELING_OPTIONS: ReadonlyArray<{ value: LevelingMode; label: string; desc: string }> = [
  { value: "off", label: "Off", desc: "Play tracks at their original volume." },
  {
    value: "replaygain",
    label: "ReplayGain",
    desc: "Use ReplayGain tags when present (album gain, so albums keep their dynamics). Untagged files play unchanged.",
  },
  {
    value: "auto",
    label: "Auto",
    desc: "Smooth out loudness differences in real time. Works on every file, no tags needed.",
  },
];

/** Volume leveling + EQ presets — applied to mpv instantly, persisted in main. */
function AudioSection() {
  const [prefs, setPrefs] = useState<AudioPrefsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .getAudioPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        if (!cancelled) setPrefs(DEFAULT_AUDIO_PREFS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;

  async function apply(next: AudioPrefsDto) {
    const prev = prefs;
    if (!prev) return;
    setPrefs(next);
    setError(null);
    try {
      await window.musex.setAudioPrefs(next);
    } catch (err) {
      // mpv refused the filter change — revert the UI to what's still in force.
      setPrefs(prev);
      setError(
        `Couldn't apply audio settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const levelingDesc = LEVELING_OPTIONS.find((o) => o.value === prefs.leveling)?.desc ?? "";

  return (
    <div className="settings-section">
      <div className="settings-section-title">Audio</div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Volume leveling</div>
          <div className="settings-row-desc">{levelingDesc}</div>
        </div>
        <select
          className="settings-input"
          aria-label="Volume leveling"
          value={prefs.leveling}
          onChange={(e) => void apply({ ...prefs, leveling: e.target.value as LevelingMode })}
        >
          {LEVELING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Equalizer</div>
          <div className="settings-row-desc">
            Presets apply instantly to the playing track.
          </div>
        </div>
        <select
          className="settings-input"
          aria-label="Equalizer preset"
          value={prefs.eqPreset}
          onChange={(e) => void apply({ ...prefs, eqPreset: e.target.value })}
        >
          {EQ_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="settings-row">
          <div className="settings-row-desc error-text">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
```

(`error-text` already exists in `theme.css` — `color: var(--red)`.)

(c) Render it in `SettingsView`'s JSX between the Local Cache section and `<ExpansionSection />`:

```tsx
      <AudioSection />
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm check`
Expected: clean. (If biome flags import order, run `pnpm exec biome check --write .`.)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: Audio settings section (volume leveling + EQ presets)" && git push
```

- [ ] **Step 4: Manual end-to-end verification (report results, do not skip)**

Run: `pnpm dev`, then in the app: Settings → Audio. Flip the equalizer to Bass
Boost while a track is playing — bass should audibly change without the track
restarting. Switch Volume leveling to Auto. Quit and relaunch — both selects
must come back with the saved values. (If no Plex server is reachable, verify
at minimum: section renders, selections persist across relaunch, no errors in
the unified log viewer.)

---

### Task 6: Final review + PR

- [ ] **Step 1: Full bar**

Run: `pnpm check` AND `MUSEX_MPV_E2E=1 pnpm --filter @musex/desktop exec vitest run src/main/adapters/mpv-controller.smoke.test.ts`
Expected: everything green.

- [ ] **Step 2: Update project docs**

In `/Users/matjam/src/musex/CLAUDE.md`, append a bullet to the Architecture section (after the audio-engine note) recording: audio filters (leveling + EQ presets) live in pure `logic/audio-filters.ts` → `MpvController.applyAudioConfig` (cached, re-applied on respawn) → IPC `musex:audio:*`; prefs persisted in the main store; presets are a fixed table (free-form filter strings are never sent to mpv).

In `README.md`, add a Features bullet under the direct-play one:

```markdown
- **Volume leveling & EQ** — optional ReplayGain or real-time loudness
  leveling, plus EQ presets (Bass Boost, Vocal, Loudness, …) applied in the
  audio engine, not the UI.
```

- [ ] **Step 3: Commit, push, open PR**

```bash
git add -A && git commit -m "docs: record audio-filter architecture + README feature bullet" && git push
gh pr create --draft --title "feat: volume leveling and EQ presets" --body "$(cat <<'EOF'
## Summary
- New **Audio** section in Settings: volume leveling (Off / ReplayGain / Auto·dynaudnorm) and EQ presets (Bass Boost, Bass Reducer, Treble Boost, Vocal Boost, Loudness)
- Filters apply instantly mid-track via mpv's `af`/`replaygain` properties over the existing JSON IPC; persisted and re-applied on every mpv (re)spawn
- All filter knowledge in pure, tested `logic/audio-filters.ts`; only fixed preset strings ever reach mpv
- Env-gated smoke test pins every preset×leveling combo against the real vendored binary

Spec: docs/superpowers/specs/2026-06-11-audio-filters-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(PR title MUST stay conventional-commit shaped — it becomes the squash subject release-please reads.)
