/**
 * loadSandboxedPlugin — loads and activates a user plugin in a QuickJS sandbox.
 *
 * Steps:
 *   1. Read the bundle source from <dir>/<manifest.entry>
 *   2. Create a SandboxContext (sync QuickJS runtime + context)
 *   3. Install the host preamble (timers, URL, console, structuredClone)
 *   4. Install the capability bridge (builds guest `ctx` from host deps)
 *   5. Load the ESM bundle via evalCode({type:"module"})
 *   6. Call guest activate(ctx)
 *   7. Register hub entries for what the guest actually registered
 *   8. Return { dispose } that tears down the context and hub registrations
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginManifest } from "@musex/plugin-api";
import type { PluginHostDeps } from "../plugin-host.js";
import type { PluginSecrets, PluginStorage } from "../plugin-store.js";
import { type BridgeResult, installBridge } from "./bridge.js";
import { SandboxContext } from "./quickjs-host.js";

export interface SandboxDeps {
  manifest: PluginManifest;
  pluginId: string;
  dir: string;
  storage: PluginStorage;
  secrets: PluginSecrets;
  hub: PluginHostDeps["hub"];
  notifySink: PluginHostDeps["notifySink"];
  openExternal: PluginHostDeps["openExternal"];
  library: PluginHostDeps["library"];
  registerSettings: (schema: import("@musex/plugin-api").SettingField[]) => void;
  onSettingsAction: (
    key: string,
    handler: () => Promise<import("@musex/plugin-api").SettingsActionResult>,
  ) => void;
  trackDisposable: (d: { dispose(): void }) => void;
}

/**
 * Load and activate a user plugin in a QuickJS sandbox.
 * Returns a `dispose` function that tears down the sandbox and hub registrations.
 */
export async function loadSandboxedPlugin(deps: SandboxDeps): Promise<{ dispose(): void }> {
  // 1. Read the bundle
  const bundlePath = join(deps.dir, deps.manifest.entry);
  const code = await readFile(bundlePath, "utf-8");

  // 2. Create the sandbox context
  const sc = await SandboxContext.create();

  let bridge: BridgeResult | null = null;

  try {
    // 3. Install preamble
    sc.installPreamble();

    // 4. Install bridge
    bridge = installBridge(sc, {
      manifest: deps.manifest,
      pluginId: deps.pluginId,
      netFetch: async (url, init) => {
        const { createNetClient } = await import("../net-client.js");
        const client = createNetClient({ allowSelfSigned: init?.allowSelfSigned });
        const res = await client(url, {
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
        });
        return {
          ok: res.ok,
          status: res.status,
          headers: Object.fromEntries(res.headers),
          body: await res.text(),
        };
      },
      storage: deps.storage,
      secrets: deps.secrets,
      library: deps.library,
      notifySink: deps.notifySink,
      openExternal: deps.openExternal,
      hub: deps.hub,
      registerSettings: deps.registerSettings,
      onSettingsAction: deps.onSettingsAction,
      trackDisposable: deps.trackDisposable,
    }) as BridgeResult;

    const entryName = deps.manifest.entry;

    // 5. Load the ESM bundle via the module loader (spike pattern).
    // Set the module loader BEFORE the eval — the runtime calls it when
    // resolving the import statement in the entry shim.
    sc.runtime_.setModuleLoader((name) => {
      if (name === entryName) return code;
      // No other module imports allowed — the bundle must be self-contained
      // (pre-bundled by esbuild with all dependencies inlined).
      throw new Error(`[sandbox] module not found: ${name}`);
    });

    // Stash the module namespace as a global so we can access activate().
    const modResult = sc.context.evalCode(
      `import * as __mod from ${JSON.stringify(entryName)}; globalThis.__sandboxModule = __mod;`,
      "__musex_entry__.mjs",
      { type: "module" },
    );
    const modPh = sc.context.unwrapResult(modResult);
    await sc.settlePromise(modPh);
    modPh.dispose();

    // 6. Call guest activate(ctx)
    await sc.evalSettle("__sandboxModule.activate(globalThis.ctx)");

    // 7. Register hub entries based on what the guest actually registered
    bridge.registerHubEntries();
  } catch (err) {
    // Clean up on activation failure
    try {
      bridge?.dispose();
    } catch {}
    sc.dispose();
    throw err;
  }

  // 8. Return dispose
  return {
    dispose() {
      try {
        bridge?.dispose();
      } catch {}
      sc.dispose();
    },
  };
}
