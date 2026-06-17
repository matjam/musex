export interface RepoRef {
  owner: string;
  repo: string;
}
export interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
  apiVersion: number;
  version: string;
  tag: string;
  asset: string;
}
export interface RepoManifest {
  schemaVersion: number;
  repo: string;
  plugins: ManifestEntry[];
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const ID_RE = /^[a-z0-9-]+$/;

/** Accepts `https://github.com/owner/repo[.git][/]`, `github.com/owner/repo`, or `owner/repo`. */
export function parseRepoUrl(input: string): RepoRef | null {
  // Normalise: strip .git suffix and trailing slashes.
  let s = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  // If it has an http(s) scheme, it MUST be github.com; otherwise reject it.
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i);
    if (!m) return null;
    const owner = m[1] ?? "";
    const repo = m[2] ?? "";
    if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
    return { owner, repo };
  }
  // Strip leading `github.com/` if present.
  s = s.replace(/^github\.com\//i, "");
  // Must now be exactly `owner/repo`.
  const m = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const owner = m[1] ?? "";
  const repo = m[2] ?? "";
  if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
  return { owner, repo };
}

export function manifestRawUrls(ref: RepoRef): string[] {
  return ["main", "master"].map(
    (b) => `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${b}/plugins.json`,
  );
}

export function releaseAssetUrl(ref: RepoRef, tag: string, asset: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

export function parsePluginsManifest(json: unknown): RepoManifest {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error("manifest is not an object");
  const m = json as Record<string, unknown>;
  if (m.schemaVersion !== 1)
    throw new Error(`unsupported manifest schemaVersion: ${String(m.schemaVersion)}`);
  if (!Array.isArray(m.plugins)) throw new Error("manifest.plugins must be an array");
  const plugins = m.plugins.map((p, i): ManifestEntry => {
    if (typeof p !== "object" || p === null) throw new Error(`plugin[${i}] is not an object`);
    const e = p as Record<string, unknown>;
    const str = (k: string): string => {
      const v = e[k];
      if (typeof v !== "string" || v === "")
        throw new Error(`plugin[${i}].${k} must be a non-empty string`);
      return v;
    };
    const id = str("id");
    if (!ID_RE.test(id)) throw new Error(`plugin[${i}].id must match ^[a-z0-9-]+$`);
    if (typeof e.apiVersion !== "number")
      throw new Error(`plugin[${i}].apiVersion must be a number`);
    return {
      id,
      name: str("name"),
      apiVersion: e.apiVersion,
      version: str("version"),
      tag: str("tag"),
      asset: str("asset"),
      ...(typeof e.description === "string" ? { description: e.description } : {}),
    };
  });
  return { schemaVersion: 1, repo: typeof m.repo === "string" ? m.repo : "", plugins };
}

export function parseSha256File(text: string): string | null {
  const m = text.trim().match(/^([a-fA-F0-9]{64})\b/);
  return m ? (m[1] ?? "").toLowerCase() || null : null;
}

/** A zip entry safe to extract: a plain filename, no separators or traversal. */
export function isSafeEntryName(name: string): boolean {
  return (
    name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".."
  );
}

/** A plugin id safe to use as a filesystem path segment (musex's id format,
 *  `^[a-z0-9-]+$`). Rejects path separators and `.`/`..` traversal — id reaches
 *  the installer from IPC, so it must be validated before any fs path use. */
export function isSafePluginId(id: string): boolean {
  return ID_RE.test(id);
}
