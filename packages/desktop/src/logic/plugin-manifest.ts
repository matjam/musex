import type { PluginManifest } from "@musex/plugin-api";

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; reason: string };

const ID_RE = /^[a-z0-9-]+$/;

/** Validate a parsed `plugin.json` against the host's API version.
 *  Pure — the host decides what to do with each failure reason (incompatible
 *  manifests are still listed; malformed ones are logged and skipped). */
export function validateManifest(json: unknown, hostApiVersion: number): ManifestValidation {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, reason: "manifest is not an object" };
  }
  const m = json as Record<string, unknown>;
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    return { ok: false, reason: "id must match /^[a-z0-9-]+$/" };
  }
  for (const field of ["name", "version", "entry"] as const) {
    if (typeof m[field] !== "string" || m[field] === "") {
      return { ok: false, reason: `${field} must be a non-empty string` };
    }
  }
  const entry = m.entry as string;
  if (entry.includes("/") || entry.includes("\\") || entry.includes("..")) {
    return { ok: false, reason: "entry must be a plain filename (no path separators or '..')" };
  }
  if (typeof m.apiVersion !== "number") {
    return { ok: false, reason: "apiVersion must be a number" };
  }
  if (m.apiVersion !== hostApiVersion) {
    return {
      ok: false,
      reason: `incompatible: requires API v${m.apiVersion}, host is v${hostApiVersion}`,
    };
  }
  const manifest: PluginManifest = {
    id: m.id,
    name: m.name as string,
    version: m.version as string,
    apiVersion: m.apiVersion,
    entry,
    ...(typeof m.description === "string" ? { description: m.description } : {}),
  };
  return { ok: true, manifest };
}
