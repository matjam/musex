import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, v: T): Promise<void>;
}

export interface PluginSecrets {
  get(key: string): Promise<string | null>;
  /** `set(key, null)` deletes the secret. */
  set(key: string, v: string | null): Promise<void>;
}

async function readJsonMap(file: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeJsonMap(
  dir: string,
  file: string,
  map: Record<string, unknown>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(map, null, 2));
}

/** Plain per-plugin key-value storage: one JSON file `<dataDir>/<id>.json`.
 *  Missing file (or missing key) reads as null. */
export function createPluginStorage(dataDir: string, id: string): PluginStorage {
  const file = join(dataDir, `${id}.json`);
  return {
    async get<T>(key: string): Promise<T | null> {
      const all = await readJsonMap(file);
      return key in all ? (all[key] as T) : null;
    },
    async set<T>(key: string, v: T): Promise<void> {
      const all = await readJsonMap(file);
      all[key] = v;
      await writeJsonMap(dataDir, file, all);
    },
  };
}

/** Per-plugin secret storage: one JSON file `<secretsDir>/<id>.json` holding
 *  `{ [key]: <encrypted base64> }`. encrypt/decrypt are injected so production
 *  can pass safeStorage wrappers and tests can pass identity functions. */
export function createPluginSecrets(
  secretsDir: string,
  id: string,
  encrypt: (s: string) => Promise<string>,
  decrypt: (s: string) => Promise<string>,
): PluginSecrets {
  const file = join(secretsDir, `${id}.json`);
  return {
    async get(key: string): Promise<string | null> {
      const all = await readJsonMap(file);
      const enc = all[key];
      if (typeof enc !== "string") return null;
      return decrypt(enc);
    },
    async set(key: string, v: string | null): Promise<void> {
      const all = await readJsonMap(file);
      if (v === null) delete all[key];
      else all[key] = await encrypt(v);
      await writeJsonMap(secretsDir, file, all);
    },
  };
}
