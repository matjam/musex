/// <reference types="node" />
/**
 * loadSandboxedPlugin — loads and activates a user plugin in a QuickJS sandbox.
 *
 * Node-coupled (reads the bundle from disk): this is the DESKTOP loader. Mobile
 * loads plugin code through the WebView harness, not this module — hence the
 * `node` types reference is scoped to this `/sandbox` file only (the package
 * keeps `types: []` so the root export stays runtime-agnostic).
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
import { type BridgeDeps, type BridgeResult, installBridge } from "./bridge.js";
import { SandboxContext } from "./quickjs-host.js";

/**
 * Dependencies for the desktop (Node) sandbox loader. It reuses BridgeDeps'
 * structural capability types (storage/secrets/library/hub/notifySink/...) so
 * the loader stays decoupled from any desktop module — including `netFetch`,
 * which the CALLER injects (desktop builds it from createNetClient). `dir` is
 * the on-disk plugin directory whose `manifest.entry` bundle is read with Node
 * fs. Mobile does NOT use this loader (it loads code through the WebView
 * harness), so the Node imports here are desktop-only.
 */
export type SandboxDeps = BridgeDeps & {
  /** On-disk directory containing the plugin bundle (`<dir>/<manifest.entry>`). */
  dir: string;
};

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

    // 4. Install bridge (netFetch is injected by the caller — the loader owns
    //    no host transport).
    bridge = installBridge(sc, {
      manifest: deps.manifest,
      pluginId: deps.pluginId,
      netFetch: deps.netFetch,
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
