import type { CacheConfig } from "@musex/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.cache-config";
const GB = 1024 * 1024 * 1024;

// Cap options offered in Settings (bytes), plus Unlimited (null).
export const CACHE_CAP_OPTIONS: { label: string; bytes: number | null }[] = [
  { label: "2 GB", bytes: 2 * GB },
  { label: "5 GB", bytes: 5 * GB },
  { label: "8 GB", bytes: 8 * GB },
  { label: "16 GB", bytes: 16 * GB },
  { label: "Unlimited", bytes: null },
];

export const DEFAULT_CACHE_CONFIG: CacheConfig = { enabled: true, capBytes: 8 * GB };

function validate(raw: unknown): CacheConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_CACHE_CONFIG;
  const o = raw as Record<string, unknown>;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : DEFAULT_CACHE_CONFIG.enabled;
  const capBytes =
    o.capBytes === null || (typeof o.capBytes === "number" && o.capBytes > 0)
      ? (o.capBytes as number | null)
      : DEFAULT_CACHE_CONFIG.capBytes;
  return { enabled, capBytes };
}

export async function loadCacheConfig(): Promise<CacheConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? validate(JSON.parse(raw) as unknown) : DEFAULT_CACHE_CONFIG;
  } catch {
    return DEFAULT_CACHE_CONFIG;
  }
}

export async function saveCacheConfig(config: CacheConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(config));
  } catch (err) {
    console.warn("[cache] config save failed", err);
  }
}
