import { describe, expect, it, vi } from "vitest";
import type { LibraryWatcherDeps } from "./library-watcher";
import { LibraryWatcher } from "./library-watcher";

/** Minimal Library shape needed by the watcher. */
function makeLib(updatedAt = 100): Parameters<LibraryWatcher["setLibrary"]>[0] {
  return {
    id: "lib1",
    serverId: "srv1",
    serverName: "My Plex",
    title: "Music",
    updatedAt,
    type: "music",
  } as Parameters<LibraryWatcher["setLibrary"]>[0];
}

function makeDeps(overrides?: Partial<LibraryWatcherDeps>): LibraryWatcherDeps {
  return {
    getToken: () => "tok",
    endpoint: vi.fn().mockResolvedValue({ baseUrl: "http://plex.local", token: "tok" }),
    listMusicLibraries: vi.fn().mockResolvedValue([makeLib(100)]),
    onChange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("LibraryWatcher.checkNow()", () => {
  it("is a no-op when the watcher is disposed", async () => {
    const deps = makeDeps();
    const watcher = new LibraryWatcher(deps);
    watcher.setLibrary(makeLib());
    watcher.dispose();
    watcher.checkNow();
    // Give any async microtasks a chance to run.
    await vi.runAllTimersAsync().catch(() => undefined);
    expect(deps.onChange).not.toHaveBeenCalled();
  });

  it("fires onChange when checkNow detects a changed timestamp", async () => {
    const lib = makeLib(100);
    const freshLib = makeLib(200); // updatedAt moved → change detected
    const deps = makeDeps({
      listMusicLibraries: vi.fn().mockResolvedValue([freshLib]),
    });
    const watcher = new LibraryWatcher(deps);
    watcher.setLibrary(lib);

    // checkNow triggers a non-forced refresh; since updatedAt changed it must
    // call onChange.
    const done = new Promise<void>((resolve) => {
      (deps.onChange as ReturnType<typeof vi.fn>).mockImplementation(() => {
        resolve();
        return Promise.resolve();
      });
    });

    watcher.checkNow();
    await done;

    expect(deps.onChange).toHaveBeenCalledWith(freshLib);
    watcher.dispose();
  });

  it("does not call onChange when the timestamp is unchanged", async () => {
    const lib = makeLib(100);
    // listMusicLibraries returns the same updatedAt → non-forced refresh skips onChange.
    const deps = makeDeps({
      listMusicLibraries: vi.fn().mockResolvedValue([makeLib(100)]),
    });
    const watcher = new LibraryWatcher(deps);
    watcher.setLibrary(lib);

    // Allow the initial ws-connect + pollOnce triggered by setLibrary to settle
    // before we clear the mock, so our assertion is isolated to checkNow.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    (deps.onChange as ReturnType<typeof vi.fn>).mockClear();

    // Now trigger checkNow — same timestamp → onChange must NOT fire.
    watcher.checkNow();
    // Give the async refresh a tick to resolve.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(deps.onChange).not.toHaveBeenCalled();
    watcher.dispose();
  });
});
