import { app, type BrowserWindow, dialog } from "electron";
// electron-updater is CJS and exposes `autoUpdater` via a lazy getter that
// Node's cjs-module-lexer can't see — a named ESM import is undefined at
// runtime. Import the default (module.exports) and destructure.
import electronUpdater, { type UpdateInfo } from "electron-updater";
import { isUpdateFeedUnavailable } from "./updater-feed-error.js";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface AutoUpdaterDeps {
  /** Current window to parent dialogs on (null → unparented dialog). */
  getWindow: () => BrowserWindow | null;
}

export interface AutoUpdaterHandle {
  /** Menu-driven check: surfaces results (up to date / downloading /
   *  downloaded / error) via dialogs. Silent checks only log. */
  checkForUpdatesInteractive: () => void;
}

type UpdaterState = "idle" | "checking" | "downloading" | "downloaded";

/** Auto-update via electron-updater + GitHub Releases (feed baked into the
 *  app as app-update.yml by electron-builder's `publish` config). Downloads
 *  in the background; prompts to restart when ready. "Later" still applies
 *  the update on next quit (autoInstallOnAppQuit). */
export function setupAutoUpdater(deps: AutoUpdaterDeps): AutoUpdaterHandle {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  // One small state machine instead of per-call listener piles: events set
  // `state`; `interactive` marks that the in-flight check came from the menu
  // and should surface its outcome in a dialog (then clears).
  let state: UpdaterState = "idle";
  let interactive = false;
  let downloadedVersion: string | null = null;

  const showDialog = (
    options: Electron.MessageBoxOptions,
  ): Promise<Electron.MessageBoxReturnValue> => {
    const win = deps.getWindow();
    return win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  };

  const promptRestart = (version: string): void => {
    void showDialog({
      type: "info",
      message: `musex ${version} has been downloaded.`,
      detail:
        "Restart now to apply the update, or it will be installed the next time you quit musex.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  };

  autoUpdater.on("checking-for-update", () => {
    if (state === "idle") state = "checking";
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    state = "downloading";
    if (interactive) {
      interactive = false;
      void showDialog({
        type: "info",
        message: `Downloading musex ${info.version}…`,
        detail: "You'll be prompted to restart when it's ready.",
      });
    }
  });

  const showUpToDate = (): void => {
    void showDialog({
      type: "info",
      message: "You're up to date",
      detail: `musex ${app.getVersion()} is the latest version.`,
    });
  };

  autoUpdater.on("update-not-available", () => {
    state = "idle";
    if (interactive) {
      interactive = false;
      showUpToDate();
    }
  });

  autoUpdater.on("error", (err: Error) => {
    state = downloadedVersion ? "downloaded" : "idle";
    // A freshly-created release whose artifacts haven't uploaded yet (or a tag
    // with no release) 404s the feed. That's not a failure — there's just no
    // update to offer — so behave as "up to date", not an error dialog.
    if (isUpdateFeedUnavailable(err)) {
      console.warn("[updater] update feed not available yet — treating as no update:", err.message);
      if (interactive) {
        interactive = false;
        showUpToDate();
      }
      return;
    }
    console.error("[updater] error:", err);
    if (interactive) {
      interactive = false;
      void showDialog({
        type: "error",
        message: "Could not check for updates",
        detail: err.message,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    state = "downloaded";
    downloadedVersion = info.version;
    interactive = false;
    promptRestart(info.version);
  });

  // On Linux, only AppImage builds can self-update. .deb / other installs
  // must go through the system package manager — electron-updater has no
  // path to update them and would error trying.
  const isPackageManagerInstall = process.platform === "linux" && !process.env.APPIMAGE;

  const silentCheck = (): void => {
    if (isPackageManagerInstall) return; // package-manager installs can't self-update
    try {
      // Failures (offline, rate-limit, no feed yet) emit "error" which we
      // log above; the promise rejection mirrors it, so just swallow-log.
      autoUpdater.checkForUpdates()?.catch((err: unknown) => {
        console.error("[updater] silent check failed:", err);
      });
    } catch (err) {
      console.error("[updater] silent check threw:", err);
    }
  };

  // Dev builds have no update feed (app-update.yml only exists in packaged
  // apps) — skip the silent schedule entirely.
  if (app.isPackaged) {
    silentCheck();
    const timer = setInterval(silentCheck, CHECK_INTERVAL_MS);
    timer.unref();
  }

  const checkForUpdatesInteractive = (): void => {
    if (isPackageManagerInstall) {
      void showDialog({
        type: "info",
        message: "Update via your package manager",
        detail:
          "musex was installed via a package — update it through your package manager (e.g. apt upgrade musex).",
      });
      return;
    }
    if (!app.isPackaged) {
      void showDialog({
        type: "info",
        message: "Updates aren't available in development builds.",
      });
      return;
    }
    if (state === "downloaded" && downloadedVersion) {
      promptRestart(downloadedVersion);
      return;
    }
    if (state === "downloading") {
      void showDialog({
        type: "info",
        message: "An update is downloading…",
        detail: "You'll be prompted to restart when it's ready.",
      });
      return;
    }
    interactive = true;
    autoUpdater.checkForUpdates()?.catch((err: unknown) => {
      // The "error" event (above) already showed the interactive dialog.
      console.error("[updater] interactive check failed:", err);
    });
  };

  return { checkForUpdatesInteractive };
}
