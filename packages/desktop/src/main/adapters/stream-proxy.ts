import type { Server, StreamRef, Track } from "@musex/core";
import { net, protocol } from "electron";
import { chooseStreamKind } from "../../logic/stream-kind.js";
import { buildProxyUrl, parseProxyUrl } from "../../logic/stream-url.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

export class StreamProxy {
  /** serverId -> live endpoint, populated when a server is connected/selected. */
  private readonly endpoints = new Map<string, ServerEndpoint>();

  registerServer(server: Server, endpoint: ServerEndpoint): void {
    this.endpoints.set(server.id, endpoint);
  }

  /** Called once in app.whenReady. */
  install(): void {
    protocol.handle("musex-stream", async (request) => {
      const parsed = parseProxyUrl(request.url);
      if (!parsed) return new Response("bad request", { status: 400 });
      const endpoint = this.endpoints.get(parsed.serverId);
      if (!endpoint) return new Response("unknown server", { status: 404 });

      const upstream = new URL(endpoint.baseUrl);
      upstream.pathname = parsed.path;
      upstream.search = parsed.search;
      upstream.searchParams.set("X-Plex-Token", endpoint.token);

      const headers = new Headers();
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);

      const res = await net.fetch(upstream.toString(), { method: "GET", headers });
      // Allow the renderer's cross-origin XHR/fetch (gapless-5/hls.js) to read the
      // response; combined with corsEnabled on the scheme this satisfies the CORS grant.
      const outHeaders = new Headers(res.headers);
      outHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(res.body, { status: res.status, headers: outHeaders });
    });
  }

  /** Resolve a track to a token-free proxy URL + kind, for the renderer engine. */
  resolve(track: Track): StreamRef {
    const kind = chooseStreamKind(track.media.audioCodec);
    const path =
      kind === "direct"
        ? track.media.partKey
        : `/music/:/transcode/universal/start.m3u8?path=${encodeURIComponent(
            `/library/metadata/${track.id}`,
          )}&protocol=hls&directStreamAudio=1`;
    return { url: buildProxyUrl(track.serverId, path), kind };
  }
}
