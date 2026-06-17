/** First-party plugins, statically imported — anything musex ships executes
 *  only bundled code. The dynamic import() path in PluginHost remains
 *  exclusively for user plugins in userData/plugins/.
 *
 *  Last.fm is now a first-party service registered directly on the ProviderHub
 *  (see main/lastfm/service.ts + runtime.ts). It no longer goes through the
 *  plugin system. Acquisition plugins (e.g. Lidarr) are installed at runtime
 *  from a GitHub repo via Settings → Plugins. */
import type { PluginContext } from "@musex/plugin-api";

export interface CorePlugin {
  manifest: { id: string; name: string; version: string; apiVersion: number };
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export const CORE_PLUGINS: readonly CorePlugin[] = [];
