import { describe, expect, it } from "vitest";
import { type HttpFn, LidarrClient, LidarrError } from "./client.js";

type Init = { method: string; headers: Record<string, string>; body?: string };
type Call = { url: string; init: Init };

function fakeHttp(status = 200, body = "{}") {
  const calls: Call[] = [];
  const httpFn: HttpFn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { calls, httpFn };
}

describe("LidarrClient", () => {
  it("strips trailing slashes from the base URL", async () => {
    const { calls, httpFn } = fakeHttp();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686///", apiKey: "k", httpFn });
    await c.get("/api/v1/system/status");
    expect(calls[0]?.url).toBe("http://lidarr:8686/api/v1/system/status");
  });

  it("builds query strings with URL encoding", async () => {
    const { calls, httpFn } = fakeHttp(200, "[]");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    await c.get("/api/v1/artist/lookup", { term: "Sigur Rós & co" });
    expect(calls[0]?.url).toBe(
      "http://lidarr:8686/api/v1/artist/lookup?term=Sigur+R%C3%B3s+%26+co",
    );
  });

  it("omits the query string when no params are given", async () => {
    const { calls, httpFn } = fakeHttp(200, "[]");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    await c.get("/api/v1/artist");
    expect(calls[0]?.url).toBe("http://lidarr:8686/api/v1/artist");
  });

  it("sends the X-Api-Key header on every request", async () => {
    const { calls, httpFn } = fakeHttp();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "sekrit", httpFn });
    await c.get("/api/v1/system/status");
    await c.post("/api/v1/command", { name: "AlbumSearch" });
    for (const call of calls) {
      expect(call.init.headers["X-Api-Key"]).toBe("sekrit");
    }
  });

  it("POSTs a JSON body with Content-Type", async () => {
    const { calls, httpFn } = fakeHttp();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    await c.post("/api/v1/command", { name: "AlbumSearch", albumIds: [3] });
    const call = calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers["Content-Type"]).toBe("application/json");
    expect(call?.init.body).toBe('{"name":"AlbumSearch","albumIds":[3]}');
  });

  it("PUTs a JSON body", async () => {
    const { calls, httpFn } = fakeHttp(202, "");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    await c.put("/api/v1/album/monitor", { albumIds: [1], monitored: true });
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.body).toBe('{"albumIds":[1],"monitored":true}');
  });

  it("tolerates an empty 2xx body (202 Accepted)", async () => {
    const { httpFn } = fakeHttp(202, "");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    await expect(c.put("/api/v1/album/monitor", { albumIds: [1] })).resolves.toBeUndefined();
  });

  it("throws LidarrError with status and body on non-2xx", async () => {
    const { httpFn } = fakeHttp(401, "Unauthorized");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "bad", httpFn });
    const err = await c.get("/api/v1/system/status").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LidarrError);
    expect((err as LidarrError).status).toBe(401);
    expect((err as LidarrError).body).toBe("Unauthorized");
  });
});
