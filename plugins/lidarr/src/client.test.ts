import { describe, expect, it } from "vitest";
import { LidarrClient, LidarrError } from "./client.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 200, body = "{}") {
  const calls: Call[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("LidarrClient", () => {
  it("strips trailing slashes from the base URL", async () => {
    const { calls, fetchFn } = fakeFetch();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686///", apiKey: "k", fetchFn });
    await c.get("/api/v1/system/status");
    expect(calls[0]?.url).toBe("http://lidarr:8686/api/v1/system/status");
  });

  it("builds query strings with URL encoding", async () => {
    const { calls, fetchFn } = fakeFetch(200, "[]");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", fetchFn });
    await c.get("/api/v1/artist/lookup", { term: "Sigur Rós & co" });
    expect(calls[0]?.url).toBe(
      "http://lidarr:8686/api/v1/artist/lookup?term=Sigur+R%C3%B3s+%26+co",
    );
  });

  it("omits the query string when no params are given", async () => {
    const { calls, fetchFn } = fakeFetch(200, "[]");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", fetchFn });
    await c.get("/api/v1/artist");
    expect(calls[0]?.url).toBe("http://lidarr:8686/api/v1/artist");
  });

  it("sends the X-Api-Key header on every request", async () => {
    const { calls, fetchFn } = fakeFetch();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "sekrit", fetchFn });
    await c.get("/api/v1/system/status");
    await c.post("/api/v1/command", { name: "AlbumSearch" });
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>)["X-Api-Key"]).toBe("sekrit");
    }
  });

  it("POSTs a JSON body with Content-Type", async () => {
    const { calls, fetchFn } = fakeFetch();
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", fetchFn });
    await c.post("/api/v1/command", { name: "AlbumSearch", albumIds: [3] });
    const call = calls[0];
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(call?.init.body).toBe('{"name":"AlbumSearch","albumIds":[3]}');
  });

  it("PUTs a JSON body", async () => {
    const { calls, fetchFn } = fakeFetch(202, "");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", fetchFn });
    await c.put("/api/v1/album/monitor", { albumIds: [1], monitored: true });
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.body).toBe('{"albumIds":[1],"monitored":true}');
  });

  it("tolerates an empty 2xx body (202 Accepted)", async () => {
    const { fetchFn } = fakeFetch(202, "");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", fetchFn });
    await expect(c.put("/api/v1/album/monitor", { albumIds: [1] })).resolves.toBeUndefined();
  });

  it("throws LidarrError with status and body on non-2xx", async () => {
    const { fetchFn } = fakeFetch(401, "Unauthorized");
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "bad", fetchFn });
    const err = await c.get("/api/v1/system/status").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LidarrError);
    expect((err as LidarrError).status).toBe(401);
    expect((err as LidarrError).body).toBe("Unauthorized");
  });
});
