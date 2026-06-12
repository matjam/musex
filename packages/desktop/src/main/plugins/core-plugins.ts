/** First-party plugins, statically imported — anything musex ships executes
 *  only bundled code. The dynamic import() path in PluginHost remains
 *  exclusively for user plugins in userData/plugins/. */
import type { PluginContext } from "@musex/plugin-api";
import * as lastfm from "@musex/plugin-lastfm";
import * as lidarr from "@musex/plugin-lidarr";

export interface CorePlugin {
  manifest: { id: string; name: string; version: string; apiVersion: number };
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export const CORE_PLUGINS: readonly CorePlugin[] = [
  { manifest: lastfm.manifest, activate: lastfm.activate },
  { manifest: lidarr.manifest, activate: lidarr.activate, deactivate: lidarr.deactivate },
];
