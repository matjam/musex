/** First-party plugins, statically imported — anything musex ships executes
 *  only bundled code. The dynamic import() path in PluginHost remains
 *  exclusively for user plugins in userData/plugins/.
 *
 *  lastfm is the only bundled core plugin. Acquisition plugins (e.g. Lidarr)
 *  are installed at runtime from a GitHub repo via Settings → Plugins. */
import type { PluginContext } from "@musex/plugin-api";
import * as lastfm from "@musex/plugin-lastfm";

export interface CorePlugin {
  manifest: { id: string; name: string; version: string; apiVersion: number };
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export const CORE_PLUGINS: readonly CorePlugin[] = [
  { manifest: lastfm.manifest, activate: lastfm.activate },
];
