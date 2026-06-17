import { describe, expect, it } from "vitest";
import { httpFnFrom } from "./transport";

describe("httpFnFrom", () => {
  it("maps a fetch Response to HttpResponse (ok/status/text)", async () => {
    const fake: typeof fetch = (async () =>
      new Response("body-text", { status: 201 })) as typeof fetch;
    const httpFn = httpFnFrom(fake);
    const res = await httpFn("http://x/y", { method: "GET", headers: {} });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("body-text");
  });
});
