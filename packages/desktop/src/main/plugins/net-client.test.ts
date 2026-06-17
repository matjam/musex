import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNetClient } from "./net-client";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, path: req.url, body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("createNetClient", () => {
  it("returns global fetch by default and when allowSelfSigned is false", () => {
    expect(createNetClient()).toBe(globalThis.fetch);
    expect(createNetClient({ allowSelfSigned: false })).toBe(globalThis.fetch);
  });

  it("allowSelfSigned client performs a GET and returns a Response", async () => {
    const f = createNetClient({ allowSelfSigned: true });
    const res = await f(`${base}/x`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ method: "GET", path: "/x" });
  });

  it("allowSelfSigned client sends a POST body and headers", async () => {
    const f = createNetClient({ allowSelfSigned: true });
    const res = await f(`${base}/y`, {
      method: "POST",
      headers: { "x-api-key": "K" },
      body: "hello",
    });
    expect(await res.json()).toMatchObject({ method: "POST", body: "hello" });
  });
});
