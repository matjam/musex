/**
 * SandboxHostView — a hidden react-native-webview that runs the plugin harness
 * (full WebKit). It owns a WebViewTransport and exposes a SandboxController so
 * the rest of the app can load/invoke/emit/dispose plugins without knowing
 * about the WebView.
 *
 * Built from the spike PoC reference (grounding §14): the harness is inlined in
 * the page HTML, RN posts via the WebView ref, the WebView posts back via
 * window.ReactNativeWebView.postMessage, and onMessage feeds the transport.
 *
 * Posts are BUFFERED until the harness emits `ready` (cold boot: the IIFE/WASM
 * init takes a tick), then flushed in order — no load/invoke is lost.
 *
 * On a WebView crash/remount (key bump) the transport is reset (in-flight
 * rejected) and `ready` re-arms; the caller (PluginManager) re-loads enabled
 * plugins.
 *
 * No JSX here (this package is .ts, not .tsx) — we use React.createElement so
 * the component compiles under the mobile tsconfig without switching files.
 */

import type { PluginManifest } from "@musex/plugin-api";
import type { BridgeRegState } from "@musex/plugin-host";
import { createElement, useCallback, useMemo, useRef } from "react";
import type { WebViewMessageEvent } from "react-native-webview";
import { WebView } from "react-native-webview";
import { HARNESS_JS } from "./harness/harness-bundle.js";
import { type TransportChannel, WebViewTransport } from "./webview-transport.js";

export interface SandboxController {
  load(pluginId: string, manifest: PluginManifest, code: string): Promise<BridgeRegState>;
  invoke(pluginId: string, path: string, method: string, args: unknown[]): Promise<unknown>;
  emit(pluginId: string, event: string, payload: unknown): void;
  dispose(pluginId: string): void;
  /** Resolves when the WebView harness is initialized and listening. */
  ready: Promise<void>;
}

type HostCallHandler = (pluginId: string, name: string, args: unknown[]) => Promise<unknown>;

export interface SandboxHostViewProps {
  hostCallHandler: HostCallHandler;
  onController(controller: SandboxController): void;
  onReady(): void;
}

/** The page served to the WebView: just the harness IIFE. originWhitelist["*"]
 *  + a baseless data/html source means there is no network origin — the only
 *  way in or out is postMessage. */
function harnessHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${HARNESS_JS}</script></body></html>`;
}

/**
 * A TransportChannel that buffers posts until the WebView ref is set AND the
 * harness has signalled `ready`, then flushes in order. Buffering survives a
 * remount: re-arming `ready` re-queues until the new page is up.
 */
class BufferingChannel implements TransportChannel {
  private ref: { postMessage(msg: string): void } | null = null;
  private ready = false;
  private queue: string[] = [];

  setRef(ref: { postMessage(msg: string): void } | null): void {
    this.ref = ref;
  }

  markReady(): void {
    this.ready = true;
    if (!this.ref) return;
    const pending = this.queue;
    this.queue = [];
    for (const msg of pending) this.ref.postMessage(msg);
  }

  /** Re-arm buffering for a fresh WebView page (remount). */
  rearm(): void {
    this.ready = false;
  }

  post(msg: string): void {
    if (this.ready && this.ref) {
      this.ref.postMessage(msg);
    } else {
      this.queue.push(msg);
    }
  }
}

export function SandboxHostView(props: SandboxHostViewProps): ReturnType<typeof createElement> {
  const { hostCallHandler, onController, onReady } = props;
  const webviewRef = useRef<WebView | null>(null);
  const readyResolveRef = useRef<(() => void) | null>(null);

  // Built once: the channel, transport, controller and the ready promise. The
  // transport outlives WebView remounts; only the channel's ready flag re-arms.
  // hostCallHandler is stable for the app lifetime (built once in the store), so
  // the empty dep array is intentional.
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once; hostCallHandler is app-lifetime-stable
  const { channel, transport, ready } = useMemo(() => {
    const ch = new BufferingChannel();
    const tx = new WebViewTransport(ch);
    tx.setHostCallHandler(hostCallHandler);
    const readyPromise = new Promise<void>((resolve) => {
      readyResolveRef.current = resolve;
    });
    return { channel: ch, transport: tx, ready: readyPromise };
  }, []);

  // Expose the controller exactly once.
  const controllerSentRef = useRef(false);
  if (!controllerSentRef.current) {
    controllerSentRef.current = true;
    transport.setReadyHandler(() => {
      channel.markReady();
      readyResolveRef.current?.();
      onReady();
    });
    const controller: SandboxController = {
      load: (pluginId, manifest, code) => transport.load(pluginId, manifest, code),
      invoke: (pluginId, path, method, args) => transport.invoke(pluginId, path, method, args),
      emit: (pluginId, event, payload) => transport.emit(pluginId, event, payload),
      dispose: (pluginId) => transport.dispose(pluginId),
      ready,
    };
    onController(controller);
  }

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      transport.onMessage(e.nativeEvent.data);
    },
    [transport],
  );

  const setRef = useCallback(
    (ref: WebView | null) => {
      webviewRef.current = ref;
      channel.setRef(ref ? { postMessage: (msg: string) => ref.postMessage(msg) } : null);
    },
    [channel],
  );

  const source = useMemo(() => ({ html: harnessHtml(), baseUrl: "" }), []);

  // Hidden, 0-size, JS-enabled WebView. No network — html source only.
  return createElement(WebView, {
    ref: setRef,
    source,
    originWhitelist: ["*"],
    javaScriptEnabled: true,
    onMessage: handleMessage,
    onContentProcessDidTerminate: () => {
      // WebView process crash: reject in-flight, re-arm buffering. The caller's
      // onReady (next page boot) drives a re-load of enabled plugins.
      transport.reset();
      channel.rearm();
    },
    // Keep it out of the layout / invisible.
    style: { width: 0, height: 0, position: "absolute", opacity: 0 },
    pointerEvents: "none",
  });
}
